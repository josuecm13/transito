import { load } from 'js-yaml';
import type { Vec2 } from './vec.ts';
import { pointInPolygon } from './geometry.ts';
import type { ScaleSpec } from './scale.ts';
import { storeyRange, streetScaleProblems } from './scale.ts';
import type { AirportParams } from './proc/airport.ts';
import type { CoverParams } from './proc/cover.ts';
import { DISTRICT_STYLES, type DistrictItem, type DistrictParams } from './proc/districts.ts';
import type { LakeParams } from './proc/lake.ts';
import type { Octaves } from './proc/noise.ts';
import type { ReliefParams, UpliftZone } from './proc/relief.ts';
import type { RoadParams, RouteSpec } from './proc/roads.ts';
import type { GrowthParams, SuitabilityParams } from './proc/settlements.ts';
import type { TransitLineSpec, TransitParams } from './proc/transit.ts';
import type { LandmarkRule } from './proc/landmarks.ts';
import type { TrailParams } from './proc/trails.ts';
import type { CanalParams, RiverParams } from './proc/water.ts';

export type Range = readonly [number, number];

export interface District {
  id: string;
  code: string;
  name: string;
  playable: 'land' | 'water';
  labelAt?: Vec2;
  sub?: string;
}

export interface WaterLabel {
  name: string;
  at: Vec2;
}

export interface Island {
  id: string;
  points: Vec2[];
}

export interface Landmark {
  id: string;
  district: string;
  position: Vec2;
  kind: string;
  onWater: boolean;
  /** Degrees in [0, 180) along the road, for landmarks placed on a generated crossing (procedural.landmarks). */
  heading?: number;
  displayName?: string;
  triggerRadius?: number;
  notes?: string;
}

export interface Route {
  id: string;
  kind: string;
  width?: number;
  points: Vec2[];
}

export interface ActiveArea {
  act: number;
  x: Range;
  y: Range;
  /** Player start; a landmark id. */
  spawn: string;
}

export interface StreetProfile {
  width: number;
  sidewalk: number;
}

/** A measured quantity as { median, iqr } (same shape as the engine's Spread). */
export interface Spread {
  median: number;
  iqr: number;
}

/**
 * Fingerprint of a frontage-lots district (`blockout.districts.<id>.frontage_lots`): what the
 * buildings along a street look like, measured on a real place. See README "Streets".
 */
export interface FrontageLots {
  /** m along the frontage. */
  width: Spread;
  /** m, perpendicular to the frontage. */
  depth: Spread;
  /** Only the median is used (m): the front face sits this far inside the buildable line. */
  frontSetback: Spread;
  /** m between neighbouring buildings along a frontage. */
  sideGap: Spread;
  /** Share of the frontage the buildings cover (0–1). Measured outcome; the realism test target. */
  coverage: number;
  /** Share of 2-storey buildings among 1- and 2-storey ones (0–1). */
  twoStoreyShare: number;
  /** m per storey: always `scale.storey` (one source; the yaml block has no level_height). */
  levelHeight: number;
  /** Informal-settlement jitter: rotation ± degrees, offset ± metres (along / inward). */
  jitter: { rotation: number; offset: number };
}

export interface BlockoutDistrict {
  lot: number;
  footprint: Range;
  height: Range;
  setback: number;
  fill: number;
  angle: number;
  /** Building method: 'parcels' (default; one building per parcel) or 'frontage-lots'. */
  method: 'parcels' | 'frontage-lots';
  /** Present exactly when method is 'frontage-lots'. */
  frontageLots?: FrontageLots;
}

export interface Blockout {
  seed: number;
  landmarkClearance: number;
  districts: Record<string, BlockoutDistrict>;
}

export interface PedestrianPopulation {
  budget: number;
  spawnRing: Range;
  despawnAt: number;
  speed: Range;
  /** Street classes whose walkways pedestrians use (sidewalks; alleys on the centerline). */
  walkOn: WalkableStreetClass[];
}

/** Every street class of the generated network: avenue (from routes) + street_styles.hierarchy. */
export const WALKABLE_STREET_CLASSES = ['avenue', 'collector', 'local', 'alley'] as const;
export type WalkableStreetClass = (typeof WALKABLE_STREET_CLASSES)[number];

/** A generated street class (street_styles.hierarchy); same shape as a street profile. */
export type StreetClassName = 'collector' | 'local' | 'alley';

/** Tensor-field basis element for formal districts. weight is unitless, decay in meters. */
export type FieldElement =
  | { kind: 'grid'; angle: number; weight?: number; decay?: number }
  | { kind: 'radial'; at: Vec2; weight?: number; decay?: number }
  | { kind: 'coastline'; weight?: number; decay?: number };

/** Organic-growth parameters for informal districts (units as commented in world.yaml). */
export interface InformalGrowth {
  segmentLength: Range;
  branchProbability: number;
  snapRadius: number;
  minAngle: number;
  alleyProbability: number;
}

/**
 * A real sector whose frozen metrics (specs/map/street-metrics.yaml, same name) the generated
 * network is compared against. Exactly one of `bbox` or `place` + `sizeM`.
 */
export interface ReferenceSector {
  name: string;
  /** [min_lon, min_lat, max_lon, max_lat] */
  bbox?: readonly [number, number, number, number];
  place?: string;
  sizeM?: number;
  note?: string;
  importAreaId?: string;
}

interface StreetStyleCommon {
  reference: ReferenceSector[];
  landUse: { park: number; court: number };
  /** Present only when the district is exempt from the realism test. */
  realismExemptReason?: string;
}

export type StreetStyleDistrict =
  | (StreetStyleCommon & { style: 'formal'; field: FieldElement[]; spacing: { collector: number; local: number } })
  | (StreetStyleCommon & { style: 'informal'; growth: InformalGrowth });

export interface StreetStyles {
  seed: number;
  hierarchy: Record<StreetClassName, StreetProfile>;
  districts: Record<string, StreetStyleDistrict>;
}

/** Sectors larger than this (km²) must be pinned to an existing engine import. */
export const MAX_SECTOR_KM2 = 2;
const EARTH_R = 6371008.8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Area (km²) of a lon/lat bbox with a local equirectangular approximation. */
export function bboxKm2(b: readonly [number, number, number, number]): number {
  const [minLon, minLat, maxLon, maxLat] = b;
  const rad = Math.PI / 180;
  const w = (maxLon - minLon) * rad * EARTH_R * Math.cos(((minLat + maxLat) / 2) * rad);
  const h = (maxLat - minLat) * rad * EARTH_R;
  return (w * h) / 1e6;
}

export interface WorldSpec {
  version: number;
  bounds: { width: number; height: number; cellSize: number };
  /** Grid rows, north row first; each row is an array of district codes. */
  grid: string[][];
  land: Vec2[];
  /** geometry.islands (optional in the yaml; empty when absent). */
  islands: Island[];
  /** geometry.water_labels (optional in the yaml; empty when absent). */
  waterLabels: WaterLabel[];
  playableBoundary: { west: Vec2[]; east: Vec2[] };
  districts: District[];
  landmarks: Landmark[];
  routes: Route[];
  activeArea: ActiveArea;
  streetProfiles: Record<string, StreetProfile>;
  blockout: Blockout;
  streetStyles: StreetStyles;
  population: { pedestrians: PedestrianPopulation };
  /** Terrain height model of the active area (relief: in world.yaml). */
  relief: ReliefSpec;
  /** Layer 3b: canal channel and locks (canal:). */
  canal: CanalSpec;
  /** Procedural isthmus inputs (procedural:), read by src/world/proc/isthmus.ts. */
  procedural: ProceduralSpec;
  /** Human scale (scale:): storey, door, lane, sidewalk, Tito's height. See src/world/scale.ts. */
  scale: ScaleSpec;
}

/** Reserved stop id in procedural roads / transit: the generated airport's terminal. */
export const AIRPORT_TERMINAL_STOP = 'airport-terminal';

/** A main road or railroad of the procedural map; `stops` are ids of `procedural.roads.stops` (or the airport terminal). */
export interface ProcRoute {
  id: string;
  kind: RouteSpec['kind'];
  stops: string[];
}

export interface ProcTown {
  id: string;
  /** Explicit seeds; empty when the town is seeded along a route (`seedAlong`). */
  seeds: Vec2[];
  /** Seeded along `route`, from its stop `from` towards the route's end; grows only near that stretch. */
  seedAlong?: { route: string; from: string; reach?: number };
  targetKm2: number;
  roadAffinity?: number;
  /** Unbuilt gaps from a noise field (see settlements.ts TownSpec.patches). */
  patches?: { wavelength: number; threshold: number };
}

/** A metro or rail line; each branch is a list of ids of `procedural.transit.stops` (or the airport terminal). */
export interface ProcLine {
  id: string;
  name: string;
  mode: TransitLineSpec['mode'];
  color: [number, number, number];
  branches: string[][];
  stationSpacing: number;
}

/** procedural: in world.yaml. Same shapes as the generator parameters, with stops named instead of inlined. */
export interface ProceduralSpec {
  /** Default generation grid (m). */
  cell: number;
  relief: ReliefParams;
  lake: LakeParams;
  rivers: RiverParams;
  canal: CanalParams;
  airport: AirportParams;
  roads: Omit<RoadParams, 'routes'> & { stops: Record<string, Vec2>; routes: ProcRoute[] };
  suitability: SuitabilityParams;
  /** `airportBuffer` (m): no town builds within this distance of the airfield. */
  towns: Omit<GrowthParams, 'towns' | 'separation'> & { separation: number; airportBuffer: number; items: ProcTown[] };
  cover: CoverParams;
  transit: Omit<TransitParams, 'lines'> & { stops: Record<string, Vec2>; lines: ProcLine[] };
  /** Coarse district influence field, refined after transit (procedural.districts; src/world/proc/districts.ts). Empty items = off. */
  districts: DistrictParams;
  /** Act 1 placement, derived from the generated transit track (procedural.act1; src/world/proc/act1.ts). */
  act1: ProcAct1;
  /** Landmarks the procedural map places by rule (procedural.landmarks; src/world/proc/landmarks.ts). */
  landmarks: { id: string; rule: LandmarkRule }[];
  /** Hiking trails (procedural.trails; src/world/proc/trails.ts). Empty = none; the map is exactly the same without them. */
  trails: TrailParams[];
  /** What the game loads from the procedural map (procedural.game; src/world/proc/game-spec.ts). */
  game: ProcGame;
}

export interface ProcGame {
  districtCell: number;
  rectMargin: number;
  /** District id for each source: sea, lake, wild, airport, and every town id. */
  districts: Record<string, string>;
}

export interface ProcAct1 {
  line: string;
  /** Stop id the followed branch ends at, and that branch's index in the line (resolved by the parser). */
  branchTo: string;
  branch: number;
  anchorAt: number;
  /** Town id; `townIndex` is its index in towns.items. */
  town: string;
  townIndex: number;
  barrioRadius: number;
  stripHalfWidth: number;
}

export class WorldSpecError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid world spec:\n- ${problems.join('\n- ')}`);
    this.name = 'WorldSpecError';
    this.problems = problems;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Reader {
  readonly problems: string[] = [];

  obj(v: unknown, path: string): Obj | undefined {
    if (v === undefined || v === null) {
      this.problems.push(`${path}: missing section`);
      return undefined;
    }
    if (!isObj(v)) {
      this.problems.push(`${path}: expected a mapping`);
      return undefined;
    }
    return v;
  }

  /** Strict keys: reports every key of `o` that is not in `allowed` (new layer sections are parsed strictly). */
  exact(o: Obj, allowed: readonly string[], path: string): void {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) this.problems.push(`${path}.${k}: unknown key (allowed: ${allowed.join(', ')})`);
    }
  }

  num(o: Obj, key: string, path: string): number {
    const v = o[key];
    if (!isNum(v)) {
      this.problems.push(`${path}.${key}: expected a number`);
      return NaN;
    }
    return v;
  }

  optNum(o: Obj, key: string, path: string): number | undefined {
    if (o[key] === undefined) return undefined;
    return this.num(o, key, path);
  }

  str(o: Obj, key: string, path: string): string {
    const v = o[key];
    if (typeof v !== 'string' || v === '') {
      this.problems.push(`${path}.${key}: expected a non-empty string`);
      return '';
    }
    return v;
  }

  optStr(o: Obj, key: string, path: string): string | undefined {
    if (o[key] === undefined) return undefined;
    return this.str(o, key, path);
  }

  pair(v: unknown, path: string): Range {
    if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) {
      this.problems.push(`${path}: expected [number, number]`);
      return [NaN, NaN];
    }
    return [v[0], v[1]];
  }

  point(v: unknown, path: string): Vec2 {
    const [x, y] = this.pair(v, path);
    return { x, y };
  }

  points(v: unknown, path: string, min: number): Vec2[] {
    if (!Array.isArray(v)) {
      this.problems.push(`${path}: expected a list of [x, y] points`);
      return [];
    }
    if (v.length < min) this.problems.push(`${path}: needs at least ${min} points`);
    return v.map((p, i) => this.point(p, `${path}[${i}]`));
  }
}


function parseSpread(r: Reader, v: unknown, path: string, minMedian: number): Spread {
  const o = r.obj(v, path);
  if (!o) return { median: NaN, iqr: NaN };
  const median = r.num(o, 'median', path);
  const iqr = r.num(o, 'iqr', path);
  if (median < minMedian) r.problems.push(`${path}.median: must be >= ${minMedian}`);
  if (iqr < 0) r.problems.push(`${path}.iqr: must be >= 0`);
  return { median, iqr };
}

const FRONTAGE_LOTS_KEYS = ['width', 'depth', 'front_setback', 'side_gap', 'coverage', 'two_storey_share', 'jitter'] as const;

function parseFrontageLots(r: Reader, v: unknown, path: string, storey: number): FrontageLots | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  r.exact(o, FRONTAGE_LOTS_KEYS, path);
  const unit = (key: string): number => {
    const x = r.num(o, key, path);
    if (!(x >= 0 && x <= 1)) r.problems.push(`${path}.${key}: must be in [0, 1]`);
    return x;
  };
  const jr = r.obj(o.jitter, `${path}.jitter`);
  const jitter = { rotation: jr ? r.num(jr, 'rotation', `${path}.jitter`) : NaN, offset: jr ? r.num(jr, 'offset', `${path}.jitter`) : NaN };
  if (jitter.rotation < 0 || jitter.offset < 0) r.problems.push(`${path}.jitter: rotation and offset must be >= 0`);
  return {
    width: parseSpread(r, o.width, `${path}.width`, 1),
    depth: parseSpread(r, o.depth, `${path}.depth`, 1),
    frontSetback: parseSpread(r, o.front_setback, `${path}.front_setback`, 0),
    sideGap: parseSpread(r, o.side_gap, `${path}.side_gap`, 0),
    coverage: unit('coverage'),
    twoStoreyShare: unit('two_storey_share'),
    levelHeight: storey,
    jitter,
  };
}

export function parseWorldSpec(rawYaml: string): WorldSpec {
  let doc: unknown;
  try {
    doc = load(rawYaml);
  } catch (e) {
    throw new WorldSpecError([`YAML syntax: ${e instanceof Error ? e.message : String(e)}`]);
  }
  if (!isObj(doc)) throw new WorldSpecError(['root: expected a mapping']);
  const r = new Reader();

  const version = r.num(doc, 'version', 'root');

  const boundsRaw = r.obj(doc.bounds, 'bounds');
  const bounds = {
    width: boundsRaw ? r.num(boundsRaw, 'width', 'bounds') : NaN,
    height: boundsRaw ? r.num(boundsRaw, 'height', 'bounds') : NaN,
    cellSize: boundsRaw ? r.num(boundsRaw, 'cell_size', 'bounds') : NaN,
  };

  let grid: string[][] = [];
  if (typeof doc.grid !== 'string') {
    r.problems.push('grid: expected a text block');
  } else {
    grid = doc.grid
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .map((l) => l.split(/\s+/));
    const cols = Math.round(bounds.width / bounds.cellSize);
    const rows = Math.round(bounds.height / bounds.cellSize);
    if (Number.isFinite(cols) && Number.isFinite(rows)) {
      if (grid.length !== rows || grid.some((row) => row.length !== cols)) {
        r.problems.push(`grid: expected ${rows} rows x ${cols} columns`);
      }
    }
  }

  const geometry = r.obj(doc.geometry, 'geometry');
  const land = geometry ? r.points(geometry.land, 'geometry.land', 3) : [];
  const islands: Island[] = [];
  if (Array.isArray(geometry?.islands)) {
    geometry.islands.forEach((raw, i) => {
      const path = `geometry.islands[${i}]`;
      const o = r.obj(raw, path);
      if (o) islands.push({ id: r.str(o, 'id', path), points: r.points(o.points, `${path}.points`, 3) });
    });
  }
  const waterLabels: WaterLabel[] = [];
  if (Array.isArray(geometry?.water_labels)) {
    geometry.water_labels.forEach((raw, i) => {
      const path = `geometry.water_labels[${i}]`;
      const o = r.obj(raw, path);
      if (o) waterLabels.push({ name: r.str(o, 'name', path), at: { x: r.num(o, 'x', path), y: r.num(o, 'y', path) } });
    });
  }
  const pb = geometry ? r.obj(geometry.playable_boundary, 'geometry.playable_boundary') : undefined;
  const pbSide = (side: 'west' | 'east'): Vec2[] => {
    if (!pb) return [];
    const s = r.obj(pb[side], `geometry.playable_boundary.${side}`);
    return s ? r.points(s.points, `geometry.playable_boundary.${side}.points`, 2) : [];
  };
  const playableBoundary = { west: pbSide('west'), east: pbSide('east') };

  const districts: District[] = [];
  if (!Array.isArray(doc.districts)) {
    r.problems.push('districts: missing section');
  } else {
    doc.districts.forEach((raw, i) => {
      const path = `districts[${i}]`;
      const o = r.obj(raw, path);
      if (!o) return;
      const playable = r.str(o, 'playable', path);
      if (playable !== '' && playable !== 'land' && playable !== 'water') {
        r.problems.push(`${path}.playable: expected "land" or "water"`);
      }
      const d: District = {
        id: r.str(o, 'id', path),
        code: r.str(o, 'code', path),
        name: r.str(o, 'name', path),
        playable: playable === 'water' ? 'water' : 'land',
      };
      if (o.label_at !== undefined) d.labelAt = r.point(o.label_at, `${path}.label_at`);
      const sub = r.optStr(o, 'sub', path);
      if (sub !== undefined) d.sub = sub;
      districts.push(d);
    });
  }
  const districtIds = new Set(districts.map((d) => d.id));
  const codes = new Set(districts.map((d) => d.code));
  for (const row of grid) {
    for (const c of row) {
      if (!codes.has(c)) r.problems.push(`grid: unknown district code "${c}"`);
    }
  }

  const landmarks: Landmark[] = [];
  if (!Array.isArray(doc.landmarks)) {
    r.problems.push('landmarks: missing section');
  } else {
    doc.landmarks.forEach((raw, i) => {
      const path = `landmarks[${i}]`;
      const o = r.obj(raw, path);
      if (!o) return;
      const lm: Landmark = {
        id: r.str(o, 'id', path),
        district: r.str(o, 'district', path),
        position: { x: r.num(o, 'x', path), y: r.num(o, 'y', path) },
        kind: r.str(o, 'kind', path),
        onWater: o.on_water === true,
      };
      if (lm.district !== '' && !districtIds.has(lm.district)) {
        r.problems.push(`${path}.district: unknown district "${lm.district}"`);
      }
      const dn = r.optStr(o, 'display_name', path);
      if (dn !== undefined) lm.displayName = dn;
      const tr = r.optNum(o, 'trigger_radius', path);
      if (tr !== undefined) lm.triggerRadius = tr;
      const notes = r.optStr(o, 'notes', path);
      if (notes !== undefined) lm.notes = notes;
      landmarks.push(lm);
    });
  }

  const routes: Route[] = [];
  const routesRaw = r.obj(doc.routes, 'routes');
  if (routesRaw) {
    for (const [id, raw] of Object.entries(routesRaw)) {
      const path = `routes.${id}`;
      const o = r.obj(raw, path);
      if (!o) continue;
      const route: Route = {
        id,
        kind: r.str(o, 'kind', path),
        points: r.points(o.points, `${path}.points`, 2),
      };
      const w = r.optNum(o, 'width', path);
      if (w !== undefined) route.width = w;
      routes.push(route);
    }
  }

  const aaRaw = r.obj(doc.active_area, 'active_area');
  let activeArea: ActiveArea = { act: NaN, x: [NaN, NaN], y: [NaN, NaN], spawn: '' };
  if (aaRaw) {
    const rect = r.obj(aaRaw.rect, 'active_area.rect');
    activeArea = {
      act: r.num(aaRaw, 'act', 'active_area'),
      x: rect ? r.pair(rect.x, 'active_area.rect.x') : [NaN, NaN],
      y: rect ? r.pair(rect.y, 'active_area.rect.y') : [NaN, NaN],
      spawn: r.str(aaRaw, 'spawn', 'active_area'),
    };
    if (activeArea.spawn !== '' && !landmarks.some((l) => l.id === activeArea.spawn)) {
      r.problems.push(`active_area.spawn: unknown landmark "${activeArea.spawn}"`);
    }
  }

  const streetProfiles: Record<string, StreetProfile> = {};
  const spRaw = r.obj(doc.street_profiles, 'street_profiles');
  if (spRaw) {
    for (const [kind, raw] of Object.entries(spRaw)) {
      const path = `street_profiles.${kind}`;
      const o = r.obj(raw, path);
      if (o) streetProfiles[kind] = { width: r.num(o, 'width', path), sidewalk: r.num(o, 'sidewalk', path) };
    }
  }
  for (const route of routes) {
    if (route.width === undefined && !(route.kind in streetProfiles)) {
      r.problems.push(`routes.${route.id}: no width and no street_profiles entry for kind "${route.kind}"`);
    }
  }

  const scale = parseScale(r, doc.scale, streetProfiles);

  const boRaw = r.obj(doc.blockout, 'blockout');
  const blockout: Blockout = { seed: NaN, landmarkClearance: NaN, districts: {} };
  if (boRaw) {
    blockout.seed = r.num(boRaw, 'seed', 'blockout');
    blockout.landmarkClearance = r.num(boRaw, 'landmark_clearance', 'blockout');
    const bd = r.obj(boRaw.districts, 'blockout.districts');
    if (bd) {
      for (const [id, raw] of Object.entries(bd)) {
        const path = `blockout.districts.${id}`;
        if (!districtIds.has(id)) r.problems.push(`${path}: unknown district "${id}"`);
        const o = r.obj(raw, path);
        if (!o) continue;
        const method = o.method ?? 'parcels';
        if (method !== 'parcels' && method !== 'frontage-lots') r.problems.push(`${path}.method: expected "parcels" or "frontage-lots"`);
        const district: BlockoutDistrict = {
          lot: r.num(o, 'lot', path),
          footprint: r.pair(o.footprint, `${path}.footprint`),
          height: r.pair(o.height, `${path}.height`),
          setback: r.num(o, 'setback', path),
          fill: r.num(o, 'fill', path),
          angle: r.num(o, 'angle', path),
          method: method === 'frontage-lots' ? 'frontage-lots' : 'parcels',
        };
        if (method === 'frontage-lots') district.frontageLots = parseFrontageLots(r, o.frontage_lots, `${path}.frontage_lots`, scale.storey);
        else if (o.frontage_lots !== undefined) r.problems.push(`${path}.frontage_lots: only valid with method "frontage-lots"`);
        blockout.districts[id] = district;
      }
    }
  }

  const streetStyles = parseStreetStyles(r, doc.street_styles, districts, grid, bounds, activeArea);
  checkScale(r, scale, streetProfiles, streetStyles, routes, blockout);
  const relief = parseRelief(r, doc.relief, bounds);

  const popRaw = r.obj(doc.population, 'population');
  const pedRaw = popRaw ? r.obj(popRaw.pedestrians, 'population.pedestrians') : undefined;
  const pp = 'population.pedestrians';
  const pedestrians: PedestrianPopulation = {
    budget: pedRaw ? r.num(pedRaw, 'budget', pp) : NaN,
    spawnRing: pedRaw ? r.pair(pedRaw.spawn_ring, `${pp}.spawn_ring`) : [NaN, NaN],
    despawnAt: pedRaw ? r.num(pedRaw, 'despawn_at', pp) : NaN,
    speed: pedRaw ? r.pair(pedRaw.speed, `${pp}.speed`) : [NaN, NaN],
    walkOn: [],
  };
  if (pedRaw) {
    if (!Array.isArray(pedRaw.walk_on) || pedRaw.walk_on.some((k) => typeof k !== 'string')) {
      r.problems.push(`${pp}.walk_on: expected a list of strings`);
    } else {
      const valid: readonly string[] = WALKABLE_STREET_CLASSES;
      const unknown = (pedRaw.walk_on as string[]).filter((k) => !valid.includes(k));
      if (unknown.length > 0) {
        r.problems.push(`${pp}.walk_on: unknown street class(es) ${unknown.join(', ')} (valid: ${valid.join(', ')})`);
      } else {
        pedestrians.walkOn = pedRaw.walk_on as WalkableStreetClass[];
      }
    }
  }

  const canal = parseCanal(r, doc.canal);
  const procedural = parseProcedural(r, doc.procedural, bounds, landmarks.map((l) => l.id), districts.map((d) => d.id));

  if (r.problems.length > 0) throw new WorldSpecError(r.problems);

  return {
    version,
    bounds,
    grid,
    land,
    islands,
    waterLabels,
    playableBoundary,
    districts,
    landmarks,
    routes,
    activeArea,
    streetProfiles,
    blockout,
    streetStyles,
    population: { pedestrians },
    relief,
    canal,
    procedural,
    scale,
  };
}

const SCALE_KEYS = ['human', 'storey', 'door', 'lane', 'sidewalk_min', 'traffic'] as const;

/** scale: (strict keys). Cross-checks against streets and buildings run later, in checkScale. */
function parseScale(r: Reader, raw: unknown, streetProfiles: Record<string, StreetProfile>): ScaleSpec {
  const out: ScaleSpec = { human: NaN, storey: NaN, door: { width: NaN, height: NaN }, lane: [NaN, NaN], sidewalkMin: NaN, traffic: [] };
  const o = r.obj(raw, 'scale');
  if (!o) return out;
  r.exact(o, SCALE_KEYS, 'scale');
  const pos = (key: string): number => {
    const v = r.num(o, key, 'scale');
    if (isNum(v) && !(v > 0)) r.problems.push(`scale.${key}: must be > 0`);
    return v;
  };
  out.human = pos('human');
  out.storey = pos('storey');
  out.sidewalkMin = pos('sidewalk_min');
  const [dw, dh] = r.pair(o.door, 'scale.door');
  out.door = { width: dw, height: dh };
  if (!(dw > 0 && dh > 0)) r.problems.push('scale.door: [width, height] must be > 0');
  else if (isNum(out.storey) && !(out.storey >= dh)) r.problems.push(`scale.storey: ${out.storey} m does not fit a ${dh} m door (scale.door)`);
  out.lane = r.pair(o.lane, 'scale.lane');
  if (!(out.lane[0] > 0 && out.lane[1] >= out.lane[0])) r.problems.push('scale.lane: expected [min, max] with 0 < min <= max');
  if (!Array.isArray(o.traffic) || o.traffic.some((k) => typeof k !== 'string')) {
    r.problems.push('scale.traffic: expected a list of street_profiles kinds');
  } else {
    out.traffic = o.traffic as string[];
    for (const k of out.traffic) if (!(k in streetProfiles)) r.problems.push(`scale.traffic: unknown street_profiles kind "${k}"`);
  }
  return out;
}

/** Streets and buildings against scale: (skipped when scale: itself is broken; its own problems are already reported). */
function checkScale(
  r: Reader,
  scale: ScaleSpec,
  streetProfiles: Record<string, StreetProfile>,
  streetStyles: StreetStyles,
  routes: Route[],
  blockout: Blockout,
): void {
  if (![scale.storey, scale.sidewalkMin, scale.lane[0], scale.lane[1]].every(isNum)) return;
  for (const k of scale.traffic) {
    const p = streetProfiles[k];
    if (p) r.problems.push(...streetScaleProblems(`street_profiles.${k}`, p, scale));
  }
  for (const [cls, p] of Object.entries(streetStyles.hierarchy)) {
    if (isNum(p.width)) r.problems.push(...streetScaleProblems(`street_styles.hierarchy.${cls}`, p, scale));
  }
  for (const route of routes) {
    if (route.width !== undefined && scale.traffic.includes(route.kind)) {
      r.problems.push(...streetScaleProblems(`routes.${route.id}`, { width: route.width, sidewalk: 0 }, scale));
    }
  }
  for (const [id, d] of Object.entries(blockout.districts)) {
    if (isNum(d.height[0]) && !storeyRange(d.height, scale.storey)) {
      r.problems.push(`blockout.districts.${id}.height: [${d.height[0]}, ${d.height[1]}] holds no whole ${scale.storey} m storey (scale.storey)`);
    }
  }
}

function parseSector(r: Reader, raw: unknown, path: string): ReferenceSector | undefined {
  const o = r.obj(raw, path);
  if (!o) return undefined;
  const sec: ReferenceSector = { name: r.str(o, 'name', path) };
  const p = `${path} (${sec.name})`;
  const note = r.optStr(o, 'note', path);
  if (note !== undefined) sec.note = note;
  const id = r.optStr(o, 'import_area_id', path);
  if (id !== undefined) {
    if (!UUID_RE.test(id)) r.problems.push(`${p}.import_area_id: expected a UUID`);
    sec.importAreaId = id;
  }
  const hasBbox = o.bbox !== undefined;
  const hasPlace = o.place !== undefined || o.size_m !== undefined;
  if (hasBbox === hasPlace) {
    r.problems.push(`${p}: needs exactly one of bbox or place + size_m`);
    return sec;
  }
  let km2: number;
  if (hasBbox) {
    const b = o.bbox;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum)) {
      r.problems.push(`${p}.bbox: expected [min_lon, min_lat, max_lon, max_lat]`);
      return sec;
    }
    const nums = b as number[];
    const bbox = [nums[0], nums[1], nums[2], nums[3]] as [number, number, number, number];
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const before = r.problems.length;
    if (!(minLon < maxLon)) r.problems.push(`${p}.bbox: min_lon must be < max_lon`);
    if (!(minLat < maxLat)) r.problems.push(`${p}.bbox: min_lat must be < max_lat`);
    if (![minLon, maxLon].every((v) => v >= -180 && v <= 180)) r.problems.push(`${p}.bbox: longitude out of [-180, 180]`);
    if (![minLat, maxLat].every((v) => v >= -90 && v <= 90)) r.problems.push(`${p}.bbox: latitude out of [-90, 90]`);
    sec.bbox = bbox;
    if (r.problems.length > before) return sec;
    km2 = bboxKm2(bbox);
  } else {
    sec.place = r.str(o, 'place', path);
    sec.sizeM = r.num(o, 'size_m', path);
    if (!(sec.sizeM > 0)) {
      r.problems.push(`${p}.size_m: must be > 0`);
      return sec;
    }
    km2 = (sec.sizeM * sec.sizeM) / 1e6;
  }
  if (km2 > MAX_SECTOR_KM2 && sec.importAreaId === undefined) {
    r.problems.push(`${p}: area ${km2.toFixed(2)} km² exceeds ${MAX_SECTOR_KM2} km² (only sectors pinned by import_area_id may be larger)`);
  }
  return sec;
}

function parseFieldElement(r: Reader, raw: unknown, path: string, bounds: WorldSpec['bounds']): FieldElement | undefined {
  const o = r.obj(raw, path);
  if (!o) return undefined;
  const opt: { weight?: number; decay?: number } = {};
  for (const k of ['weight', 'decay'] as const) {
    const v = r.optNum(o, k, path);
    if (v === undefined) continue;
    if (!(v > 0)) r.problems.push(`${path}.${k}: must be > 0`);
    opt[k] = v;
  }
  switch (o.kind) {
    case 'grid':
      return { kind: 'grid', angle: r.num(o, 'angle', path), ...opt };
    case 'radial': {
      const at = r.point(o.at, `${path}.at`);
      if (!(at.x >= 0 && at.x <= bounds.width && at.y >= 0 && at.y <= bounds.height)) {
        r.problems.push(`${path}.at: outside bounds`);
      }
      return { kind: 'radial', at, ...opt };
    }
    case 'coastline':
      return { kind: 'coastline', ...opt };
    default:
      r.problems.push(`${path}.kind: expected "grid", "radial" or "coastline", got ${JSON.stringify(o.kind)}`);
      return undefined;
  }
}

function parseStreetStyles(
  r: Reader,
  raw: unknown,
  districts: District[],
  grid: string[][],
  bounds: WorldSpec['bounds'],
  activeArea: ActiveArea,
): StreetStyles {
  const out: StreetStyles = {
    seed: NaN,
    hierarchy: {
      collector: { width: NaN, sidewalk: NaN },
      local: { width: NaN, sidewalk: NaN },
      alley: { width: NaN, sidewalk: NaN },
    },
    districts: {},
  };
  const ss = r.obj(raw, 'street_styles');
  if (!ss) return out;
  out.seed = r.num(ss, 'seed', 'street_styles');
  if (isNum(out.seed) && !Number.isInteger(out.seed)) r.problems.push('street_styles.seed: expected an integer');

  const hier = r.obj(ss.hierarchy, 'street_styles.hierarchy');
  if (hier) {
    for (const cls of ['collector', 'local', 'alley'] as const) {
      const path = `street_styles.hierarchy.${cls}`;
      const o = r.obj(hier[cls], path);
      if (!o) continue;
      const h = { width: r.num(o, 'width', path), sidewalk: r.num(o, 'sidewalk', path) };
      if (!(h.width > 0)) r.problems.push(`${path}.width: must be > 0`);
      if (!(h.sidewalk >= 0)) r.problems.push(`${path}.sidewalk: must be >= 0`);
      if (cls === 'alley' && h.sidewalk !== 0) r.problems.push(`${path}.sidewalk: must be 0`);
      out.hierarchy[cls] = h;
    }
  }

  const districtIds = new Set(districts.map((d) => d.id));
  const sd = r.obj(ss.districts, 'street_styles.districts');
  if (sd) {
    for (const [id, rawD] of Object.entries(sd)) {
      const path = `street_styles.districts.${id}`;
      if (!districtIds.has(id)) r.problems.push(`${path}: unknown district "${id}"`);
      const o = r.obj(rawD, path);
      if (!o) continue;

      const luRaw = r.obj(o.land_use, `${path}.land_use`);
      const landUse = { park: NaN, court: NaN };
      if (luRaw) {
        landUse.park = r.num(luRaw, 'park', `${path}.land_use`);
        landUse.court = r.num(luRaw, 'court', `${path}.land_use`);
        for (const k of ['park', 'court'] as const) {
          if (isNum(landUse[k]) && !(landUse[k] >= 0 && landUse[k] <= 1)) {
            r.problems.push(`${path}.land_use.${k}: must be in [0, 1]`);
          }
        }
        if (isNum(landUse.park) && isNum(landUse.court) && !(landUse.park + landUse.court < 1)) {
          r.problems.push(`${path}.land_use: park + court must be < 1`);
        }
      }

      let realismExemptReason: string | undefined;
      if (o.realism !== undefined) {
        if (o.realism !== 'exempt') {
          r.problems.push(`${path}.realism: only "exempt" is allowed`);
        } else if (typeof o.realism_reason !== 'string' || o.realism_reason.trim() === '') {
          r.problems.push(`${path}: realism: exempt requires a non-empty realism_reason`);
        } else {
          realismExemptReason = o.realism_reason;
        }
      } else if (o.realism_reason !== undefined) {
        r.problems.push(`${path}: realism_reason without realism: exempt`);
      }

      const reference: ReferenceSector[] = [];
      if (o.reference !== undefined && !Array.isArray(o.reference)) {
        r.problems.push(`${path}.reference: expected a list of sectors`);
      } else if (Array.isArray(o.reference)) {
        o.reference.forEach((s, i) => {
          const sec = parseSector(r, s, `${path}.reference[${i}]`);
          if (sec) reference.push(sec);
        });
      }
      if (reference.length === 0 && o.realism !== 'exempt') {
        r.problems.push(`${path}: needs at least one reference sector (or realism: exempt + realism_reason)`);
      }

      const common: StreetStyleCommon = { reference, landUse };
      if (realismExemptReason !== undefined) common.realismExemptReason = realismExemptReason;

      if (o.style === 'formal') {
        const field: FieldElement[] = [];
        if (!Array.isArray(o.field) || o.field.length === 0) {
          r.problems.push(`${path}.field: formal style needs a non-empty list`);
        } else {
          o.field.forEach((el, i) => {
            const f = parseFieldElement(r, el, `${path}.field[${i}]`, bounds);
            if (f) field.push(f);
          });
        }
        const spRaw = r.obj(o.spacing, `${path}.spacing`);
        const spacing = { collector: NaN, local: NaN };
        if (spRaw) {
          for (const k of ['collector', 'local'] as const) {
            spacing[k] = r.num(spRaw, k, `${path}.spacing`);
            if (isNum(spacing[k]) && !(spacing[k] > 0)) r.problems.push(`${path}.spacing.${k}: must be > 0`);
          }
        }
        out.districts[id] = { ...common, style: 'formal', field, spacing };
      } else if (o.style === 'informal') {
        const gp = `${path}.growth`;
        const g = r.obj(o.growth, gp);
        const growth: InformalGrowth = {
          segmentLength: [NaN, NaN],
          branchProbability: NaN,
          snapRadius: NaN,
          minAngle: NaN,
          alleyProbability: NaN,
        };
        if (g) {
          growth.segmentLength = r.pair(g.segment_length, `${gp}.segment_length`);
          const [lo, hi] = growth.segmentLength;
          if (isNum(lo) && isNum(hi) && !(lo > 0 && lo <= hi)) {
            r.problems.push(`${gp}.segment_length: expected 0 < min <= max`);
          }
          growth.branchProbability = r.num(g, 'branch_probability', gp);
          growth.snapRadius = r.num(g, 'snap_radius', gp);
          growth.minAngle = r.num(g, 'min_angle', gp);
          growth.alleyProbability = r.num(g, 'alley_probability', gp);
          const pos = { branch_probability: growth.branchProbability, snap_radius: growth.snapRadius,
            min_angle: growth.minAngle, alley_probability: growth.alleyProbability };
          for (const [k, v] of Object.entries(pos)) {
            if (isNum(v) && !(v > 0)) r.problems.push(`${gp}.${k}: must be > 0`);
          }
          for (const [k, v] of [['branch_probability', growth.branchProbability], ['alley_probability', growth.alleyProbability]] as const) {
            if (isNum(v) && v > 1) r.problems.push(`${gp}.${k}: must be <= 1`);
          }
        }
        out.districts[id] = { ...common, style: 'informal', growth };
      } else {
        r.problems.push(`${path}.style: expected "formal" or "informal", got ${JSON.stringify(o.style)}`);
      }
    }

    // Every land district with a grid cell inside the active area needs a street style.
    const cs = bounds.cellSize;
    const [x0, x1] = activeArea.x;
    const [y0, y1] = activeArea.y;
    const missing = new Set<string>();
    grid.forEach((row, ri) => row.forEach((code, c) => {
      const cy0 = (grid.length - 1 - ri) * cs;
      const cx0 = c * cs;
      if (!(cx0 < x1 && cx0 + cs > x0 && cy0 < y1 && cy0 + cs > y0)) return;
      const d = districts.find((dd) => dd.code === code);
      if (d && d.playable === 'land' && !(d.id in sd)) missing.add(d.id);
    }));
    for (const id of [...missing].sort()) {
      r.problems.push(`street_styles.districts: active-area land district "${id}" has no entry`);
    }
  }
  return out;
}

/** District owning point p per the area-budget grid (north row first), or undefined outside. */
export function districtAt(spec: WorldSpec, p: Vec2): District | undefined {
  const { cellSize } = spec.bounds;
  const col = Math.floor(p.x / cellSize);
  const row = spec.grid.length - 1 - Math.floor(p.y / cellSize);
  const code = spec.grid[row]?.[col];
  if (code === undefined) return undefined;
  return spec.districts.find((d) => d.code === code);
}

/**
 * Where a district's name goes on a map: `label_at` when the spec gives one, otherwise the
 * center of the district's grid cell nearest to the centroid of all its cells (same rule as
 * tools/render_map_preview.py). Undefined when that fallback point is not on land (open sea).
 */
export function districtLabelPoint(spec: WorldSpec, d: District): Vec2 | undefined {
  if (d.labelAt) return d.labelAt;
  const cells: [number, number][] = [];
  spec.grid.forEach((row, r) => row.forEach((code, c) => {
    if (code === d.code) cells.push([c, r]);
  }));
  if (cells.length === 0) return undefined;
  const mc = cells.reduce((a, [c]) => a + c, 0) / cells.length;
  const mr = cells.reduce((a, [, r]) => a + r, 0) / cells.length;
  let best = cells[0] as [number, number];
  for (const cell of cells) {
    if ((cell[0] - mc) ** 2 + (cell[1] - mr) ** 2 < (best[0] - mc) ** 2 + (best[1] - mr) ** 2) best = cell;
  }
  const size = spec.bounds.cellSize;
  const p = { x: (best[0] + 0.5) * size, y: (spec.grid.length - best[1] - 0.5) * size };
  return pointInPolygon(p, spec.land) ? p : undefined;
}

// ---------------------------------------------------------------------------------------------
// relief (terrain height model). Semantics: README.md "Relief". The game reads only `relief.grid` (ProcTerrain,
// src/world/proc/game-world.ts); the authored height model was retired (#12 2.5, card F5).

/** Seeded fractal noise: `octaves` layers, each with half the wavelength and `persistence` x the amplitude. */
export interface NoiseSpec {
  /** m */
  amplitude: number;
  /** m, lowest octave */
  wavelength: number;
  octaves: number;
  persistence: number;
}

export interface HillFeature {
  id: string;
  inspiredBy?: string;
  at: Vec2;
  /** m, full effect inside */
  coreRadius: number;
  /** m, effect ends */
  radius: number;
  /** m added at the core */
  uplift: number;
  noise: NoiseSpec;
}

/** Axis-aligned flat zone: `level` (a height or the zone's mean) or `cap` (a ceiling). */
export interface FlattenZone {
  id: string;
  rect: { minX: number; minY: number; maxX: number; maxY: number };
  level: 'auto' | number | undefined;
  cap: number | undefined;
  /** m, blend back to the natural terrain outside the rect */
  blend: number;
}

export interface BandRange {
  min: number;
  max: number;
}

/** Linear relief feature (layer 2): h = amplitude * exp(-(s / width)^2), s = distance to the crest polyline. */
export interface RidgeFeature {
  id: string;
  inspiredBy?: string;
  /** Crest polyline, m. */
  points: Vec2[];
  /** m, half-width at 1/e */
  width: number;
  /** m, crest height above the base terrain */
  amplitude: number;
}

export interface ReliefSpec {
  seed: number;
  seaFloor: { slope: number; minHeight: number };
  coastalRamp: { slope: number; maxHeight: number; noiseTaper: number };
  /** m, inland ground never drops below this (drainage floor) */
  landFloor: number;
  rolling: NoiseSpec;
  hills: HillFeature[];
  /** Whole-isthmus ridges (layer 2). */
  ridges: RidgeFeature[];
  /**
   * Regional uplift outside the active area (layer 2): `height` + `noise` m added on top of the base
   * terrain, fading in over `rectBlend` m beyond the active rect and over `coastBlend` m inland from
   * the shore, so the active area and the shoreline keep their calibrated relief. Ridges fade in the
   * same way over `ridgeRectBlend` m (shorter, so a crest just outside the rect still reaches full height).
   */
  upland: { height: number; rectBlend: number; ridgeRectBlend: number; coastBlend: number; noise: NoiseSpec };
  flatten: FlattenZone[];
  landmarkPads: { radius: number; blend: number };
  streets: { maxGrade: number; shoulder: number };
  grid: { cell: number; margin: number; far: { cell: number } };
  targets: {
    hills: { slopeP50: BandRange; slopeP90: BandRange; slopeP99Max: number };
    plain: { slopeP50: BandRange; slopeP90: BandRange; slopeMax: number };
    runwayFlatTolerance: number;
    coastTolerance: number;
  };
}

function parseRelief(r: Reader, raw: unknown, bounds: { width: number; height: number }): ReliefSpec {
  const o = r.obj(raw, 'relief');
  const empty = (): ReliefSpec => ({
    seed: NaN,
    seaFloor: { slope: NaN, minHeight: NaN },
    coastalRamp: { slope: NaN, maxHeight: NaN, noiseTaper: NaN },
    landFloor: NaN,
    rolling: { amplitude: NaN, wavelength: NaN, octaves: NaN, persistence: NaN },
    hills: [],
    ridges: [],
    upland: { height: NaN, rectBlend: NaN, ridgeRectBlend: NaN, coastBlend: NaN, noise: { amplitude: NaN, wavelength: NaN, octaves: NaN, persistence: NaN } },
    flatten: [],
    landmarkPads: { radius: NaN, blend: NaN },
    streets: { maxGrade: NaN, shoulder: NaN },
    grid: { cell: NaN, margin: NaN, far: { cell: NaN } },
    targets: {
      hills: { slopeP50: { min: NaN, max: NaN }, slopeP90: { min: NaN, max: NaN }, slopeP99Max: NaN },
      plain: { slopeP50: { min: NaN, max: NaN }, slopeP90: { min: NaN, max: NaN }, slopeMax: NaN },
      runwayFlatTolerance: NaN,
      coastTolerance: NaN,
    },
  });
  if (!o) return empty();
  const pos = (v: number, path: string): number => {
    if (!(v > 0)) r.problems.push(`${path}: must be > 0`);
    return v;
  };
  const section = (key: string, parent: Obj = o, base = 'relief'): Obj | undefined => r.obj(parent[key], `${base}.${key}`);
  const noise = (v: unknown, path: string): NoiseSpec => {
    const n = r.obj(v, path);
    const out: NoiseSpec = { amplitude: NaN, wavelength: NaN, octaves: NaN, persistence: NaN };
    if (!n) return out;
    out.amplitude = r.num(n, 'amplitude', path);
    out.wavelength = pos(r.num(n, 'wavelength', path), `${path}.wavelength`);
    out.octaves = r.num(n, 'octaves', path);
    if (!Number.isInteger(out.octaves) || out.octaves < 1 || out.octaves > 8) r.problems.push(`${path}.octaves: expected an integer in [1, 8]`);
    out.persistence = r.num(n, 'persistence', path);
    if (!(out.persistence > 0 && out.persistence < 1)) r.problems.push(`${path}.persistence: expected a number in (0, 1)`);
    return out;
  };
  const band = (v: unknown, path: string): BandRange => {
    const [min, max] = r.pair(v, path);
    if (!(min < max)) r.problems.push(`${path}: expected [min, max] with min < max`);
    return { min, max };
  };
  const inBounds = (p: Vec2, path: string): void => {
    if (!(p.x >= 0 && p.x <= bounds.width && p.y >= 0 && p.y <= bounds.height)) r.problems.push(`${path}: outside the map bounds`);
  };

  const out = empty();
  out.seed = r.num(o, 'seed', 'relief');
  const sf = section('sea_floor');
  if (sf) out.seaFloor = { slope: pos(r.num(sf, 'slope', 'relief.sea_floor'), 'relief.sea_floor.slope'), minHeight: r.num(sf, 'min_height', 'relief.sea_floor') };
  if (out.seaFloor.minHeight >= 0) r.problems.push('relief.sea_floor.min_height: must be < 0');
  const cr = section('coastal_ramp');
  if (cr) {
    const p = 'relief.coastal_ramp';
    out.coastalRamp = { slope: r.num(cr, 'slope', p), maxHeight: pos(r.num(cr, 'max_height', p), `${p}.max_height`), noiseTaper: pos(r.num(cr, 'noise_taper', p), `${p}.noise_taper`) };
    if (out.coastalRamp.slope < 0) r.problems.push(`${p}.slope: must be >= 0`);
  }
  out.landFloor = r.num(o, 'land_floor', 'relief');
  out.rolling = noise(o.rolling, 'relief.rolling');

  if (!Array.isArray(o.hills)) {
    r.problems.push('relief.hills: expected a list');
  } else {
    o.hills.forEach((raw2, i) => {
      const p = `relief.hills[${i}]`;
      const h = r.obj(raw2, p);
      if (!h) return;
      const hill: HillFeature = {
        id: r.str(h, 'id', p),
        at: r.point(h.at, `${p}.at`),
        coreRadius: pos(r.num(h, 'core_radius', p), `${p}.core_radius`),
        radius: r.num(h, 'radius', p),
        uplift: r.num(h, 'uplift', p),
        noise: noise(h.noise, `${p}.noise`),
      };
      const ins = r.optStr(h, 'inspired_by', p);
      if (ins !== undefined) hill.inspiredBy = ins;
      if (!(hill.radius > hill.coreRadius)) r.problems.push(`${p}.radius: must be > core_radius`);
      inBounds(hill.at, `${p}.at`);
      out.hills.push(hill);
    });
  }

  if (!Array.isArray(o.ridges)) {
    r.problems.push('relief.ridges: expected a list');
  } else {
    o.ridges.forEach((raw2, i) => {
      const p = `relief.ridges[${i}]`;
      const rd = r.obj(raw2, p);
      if (!rd) return;
      r.exact(rd, ['id', 'inspired_by', 'points', 'width', 'amplitude'], p);
      const ridge: RidgeFeature = {
        id: r.str(rd, 'id', p),
        points: r.points(rd.points, `${p}.points`, 2),
        width: pos(r.num(rd, 'width', p), `${p}.width`),
        amplitude: pos(r.num(rd, 'amplitude', p), `${p}.amplitude`),
      };
      const ins = r.optStr(rd, 'inspired_by', p);
      if (ins !== undefined) ridge.inspiredBy = ins;
      ridge.points.forEach((pt, j) => inBounds(pt, `${p}.points[${j}]`));
      out.ridges.push(ridge);
    });
  }

  const up = section('upland');
  if (up) {
    const p = 'relief.upland';
    r.exact(up, ['height', 'rect_blend', 'ridge_rect_blend', 'coast_blend', 'noise'], p);
    out.upland = { height: r.num(up, 'height', p), rectBlend: pos(r.num(up, 'rect_blend', p), `${p}.rect_blend`), ridgeRectBlend: pos(r.num(up, 'ridge_rect_blend', p), `${p}.ridge_rect_blend`), coastBlend: pos(r.num(up, 'coast_blend', p), `${p}.coast_blend`), noise: noise(up.noise, `${p}.noise`) };
    if (out.upland.height < 0) r.problems.push(`${p}.height: must be >= 0`);
  }

  if (!Array.isArray(o.flatten)) {
    r.problems.push('relief.flatten: expected a list');
  } else {
    o.flatten.forEach((raw2, i) => {
      const p = `relief.flatten[${i}]`;
      const z = r.obj(raw2, p);
      if (!z) return;
      const rect = r.points(z.rect, `${p}.rect`, 2);
      if (rect.length !== 2) r.problems.push(`${p}.rect: expected [[minX, minY], [maxX, maxY]]`);
      const [a, b] = [rect[0] ?? { x: NaN, y: NaN }, rect[1] ?? { x: NaN, y: NaN }];
      if (!(a.x < b.x && a.y < b.y)) r.problems.push(`${p}.rect: min corner must be south-west of max corner`);
      inBounds(a, `${p}.rect[0]`);
      inBounds(b, `${p}.rect[1]`);
      const hasLevel = z.level !== undefined;
      const hasCap = z.cap !== undefined;
      if (hasLevel === hasCap) r.problems.push(`${p}: needs exactly one of level or cap`);
      let level: 'auto' | number | undefined;
      if (hasLevel) {
        if (z.level === 'auto') level = 'auto';
        else level = r.num(z, 'level', p);
      }
      const blend = r.num(z, 'blend', p);
      if (!(blend >= 0)) r.problems.push(`${p}.blend: must be >= 0`);
      out.flatten.push({
        id: r.str(z, 'id', p),
        rect: { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y },
        level,
        cap: hasCap ? r.num(z, 'cap', p) : undefined,
        blend,
      });
    });
  }

  const lp = section('landmark_pads');
  if (lp) out.landmarkPads = { radius: pos(r.num(lp, 'radius', 'relief.landmark_pads'), 'relief.landmark_pads.radius'), blend: pos(r.num(lp, 'blend', 'relief.landmark_pads'), 'relief.landmark_pads.blend') };

  const st = section('streets');
  if (st) out.streets = { maxGrade: pos(r.num(st, 'max_grade', 'relief.streets'), 'relief.streets.max_grade'), shoulder: r.num(st, 'shoulder', 'relief.streets') };
  if (out.streets.maxGrade >= 1) r.problems.push('relief.streets.max_grade: expected a fraction below 1');
  const gr = section('grid');
  if (gr) {
    r.exact(gr, ['cell', 'margin', 'far'], 'relief.grid');
    out.grid = { cell: pos(r.num(gr, 'cell', 'relief.grid'), 'relief.grid.cell'), margin: r.num(gr, 'margin', 'relief.grid'), far: { cell: NaN } };
    const far = r.obj(gr.far, 'relief.grid.far');
    if (far) {
      r.exact(far, ['cell'], 'relief.grid.far');
      out.grid.far = { cell: pos(r.num(far, 'cell', 'relief.grid.far'), 'relief.grid.far.cell') };
      if (!(out.grid.far.cell > out.grid.cell)) r.problems.push('relief.grid.far.cell: must be coarser than relief.grid.cell');
      if (bounds.width % out.grid.far.cell !== 0 || bounds.height % out.grid.far.cell !== 0) {
        r.problems.push(`relief.grid.far.cell: must divide the map size ${bounds.width} x ${bounds.height}`);
      }
    }
  }
  if (out.grid.margin < 0) r.problems.push('relief.grid.margin: must be >= 0');

  const tg = section('targets');
  if (tg) {
    const h = r.obj(tg.hills, 'relief.targets.hills');
    if (h) out.targets.hills = { slopeP50: band(h.slope_p50, 'relief.targets.hills.slope_p50'), slopeP90: band(h.slope_p90, 'relief.targets.hills.slope_p90'), slopeP99Max: r.num(h, 'slope_p99_max', 'relief.targets.hills') };
    const pl = r.obj(tg.plain, 'relief.targets.plain');
    if (pl) out.targets.plain = { slopeP50: band(pl.slope_p50, 'relief.targets.plain.slope_p50'), slopeP90: band(pl.slope_p90, 'relief.targets.plain.slope_p90'), slopeMax: r.num(pl, 'slope_max', 'relief.targets.plain') };
    out.targets.runwayFlatTolerance = r.num(tg, 'runway_flat_tolerance', 'relief.targets');
    out.targets.coastTolerance = r.num(tg, 'coast_tolerance', 'relief.targets');
  }
  return out;
}


// ---------------------------------------------------------------------------------------------
// Layers 1-5 (whole isthmus). Semantics: README.md "Layers". Parsed and validated (and drawn in preview.svg);
// their generators were retired (#12 2.5, card F5): the game runs on the procedural map (src/world/proc).
// These sections are parsed strictly: an unknown key is an error.

export interface LockSpec {
  id: string;
  /** Landmark id the lock flight sits at. */
  landmark: string;
  inspiredBy?: string;
  steps: number;
  /** [length, width] of one chamber, m. */
  chamber: Range;
}

export interface CanalSpec {
  /** routes entry of kind waterway used as the centreline. */
  route: string;
  width: number;
  seaLevel: number;
  lakeLevel: number;
  apron: number;
  locks: LockSpec[];
  bridgeLandmarks: string[];
}


function listOf(r: Reader, v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) {
    r.problems.push(`${path}: expected a list`);
    return [];
  }
  return v;
}

function strList(r: Reader, v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x === '')) {
    r.problems.push(`${path}: expected a list of non-empty strings`);
    return [];
  }
  return v as string[];
}

function positive(r: Reader, v: number, path: string): number {
  if (!(v > 0)) r.problems.push(`${path}: must be > 0`);
  return v;
}

function parseCanal(r: Reader, raw: unknown): CanalSpec {
  const path = 'canal';
  const out: CanalSpec = { route: '', width: NaN, seaLevel: NaN, lakeLevel: NaN, apron: NaN, locks: [], bridgeLandmarks: [] };
  const o = r.obj(raw, path);
  if (!o) return out;
  r.exact(o, ['route', 'width', 'sea_level', 'lake_level', 'apron', 'locks', 'bridge_landmarks'], path);
  out.route = r.str(o, 'route', path);
  out.width = positive(r, r.num(o, 'width', path), `${path}.width`);
  out.seaLevel = r.num(o, 'sea_level', path);
  out.lakeLevel = r.num(o, 'lake_level', path);
  if (!(out.lakeLevel > out.seaLevel)) r.problems.push(`${path}.lake_level: must be above sea_level`);
  out.apron = r.num(o, 'apron', path);
  if (out.apron < 0) r.problems.push(`${path}.apron: must be >= 0`);
  out.locks = listOf(r, o.locks, `${path}.locks`).flatMap((raw2, i) => {
    const p = `${path}.locks[${i}]`;
    const lk = r.obj(raw2, p);
    if (!lk) return [];
    r.exact(lk, ['id', 'landmark', 'inspired_by', 'steps', 'chamber'], p);
    const steps = r.num(lk, 'steps', p);
    if (!Number.isInteger(steps) || steps < 1) r.problems.push(`${p}.steps: expected an integer >= 1`);
    const chamber = r.pair(lk.chamber, `${p}.chamber`);
    if (!(chamber[0] > chamber[1] && chamber[1] > 0)) r.problems.push(`${p}.chamber: expected [length, width] with length > width > 0`);
    const lock: LockSpec = { id: r.str(lk, 'id', p), landmark: r.str(lk, 'landmark', p), steps, chamber };
    const ins = r.optStr(lk, 'inspired_by', p);
    if (ins !== undefined) lock.inspiredBy = ins;
    return [lock];
  });
  out.bridgeLandmarks = strList(r, o.bridge_landmarks, `${path}.bridge_landmarks`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// procedural: inputs of the procedural isthmus (src/world/proc/). Strict keys everywhere.

type NumRule = 'any' | 'pos' | 'nonneg' | 'frac' | 'int1';

class ProcReader {
  readonly r: Reader;
  readonly bounds: { width: number; height: number };
  constructor(r: Reader, bounds: { width: number; height: number }) {
    this.r = r;
    this.bounds = bounds;
  }

  /** A mapping with exactly `keys` allowed (`optional` may be absent). */
  sec(v: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Obj | undefined {
    const o = this.r.obj(v, path);
    if (!o) return undefined;
    this.r.exact(o, [...keys, ...optional], path);
    for (const k of keys) if (o[k] === undefined) this.r.problems.push(`${path}.${k}: missing`);
    return o;
  }

  num(o: Obj, key: string, path: string, rule: NumRule = 'any'): number {
    const v = this.r.num(o, key, path);
    if (Number.isNaN(v)) return v;
    const p = `${path}.${key}`;
    if (rule === 'pos' && !(v > 0)) this.r.problems.push(`${p}: must be > 0`);
    if (rule === 'nonneg' && !(v >= 0)) this.r.problems.push(`${p}: must be >= 0`);
    if (rule === 'frac' && !(v >= 0 && v <= 1)) this.r.problems.push(`${p}: expected a fraction in [0, 1]`);
    if (rule === 'int1' && !(Number.isInteger(v) && v >= 1)) this.r.problems.push(`${p}: expected an integer >= 1`);
    return v;
  }

  /** [a, b] with a < b. */
  span(v: unknown, path: string): readonly [number, number] {
    const [a, b] = this.r.pair(v, path);
    if (!(a < b)) this.r.problems.push(`${path}: expected [min, max] with min < max`);
    return [a, b];
  }

  /** A map point inside the bounds (edges included). */
  at(v: unknown, path: string): Vec2 {
    const p = this.r.point(v, path);
    if (!(p.x >= 0 && p.x <= this.bounds.width && p.y >= 0 && p.y <= this.bounds.height)) this.r.problems.push(`${path}: (${p.x}, ${p.y}) is outside the map`);
    return p;
  }

  ats(v: unknown, path: string, min: number): Vec2[] {
    if (!Array.isArray(v)) {
      this.r.problems.push(`${path}: expected a list of [x, y] points`);
      return [];
    }
    if (v.length < min) this.r.problems.push(`${path}: needs at least ${min} points`);
    return v.map((p, i) => this.at(p, `${path}[${i}]`));
  }

  octaves(v: unknown, path: string): Octaves {
    const o = this.sec(v, path, ['wavelength', 'octaves'], ['gain', 'lacunarity']);
    if (!o) return { wavelength: NaN, octaves: NaN };
    const out: { wavelength: number; octaves: number; gain?: number; lacunarity?: number } = {
      wavelength: this.num(o, 'wavelength', path, 'pos'),
      octaves: this.num(o, 'octaves', path, 'int1'),
    };
    if (o.gain !== undefined) out.gain = this.num(o, 'gain', path, 'frac');
    if (o.lacunarity !== undefined) {
      out.lacunarity = this.num(o, 'lacunarity', path);
      if (!(out.lacunarity > 1)) this.r.problems.push(`${path}.lacunarity: must be > 1`);
    }
    return out;
  }

  /** Unique ids across a list. */
  unique(ids: readonly string[], path: string): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) this.r.problems.push(`${path}: duplicate id '${id}'`);
      seen.add(id);
    }
  }

  /** `stops:` mapping of id -> point. The reserved airport terminal id may not be redefined. */
  stops(v: unknown, path: string): Record<string, Vec2> {
    const o = this.r.obj(v, path);
    const out: Record<string, Vec2> = {};
    if (!o) return out;
    for (const [k, p] of Object.entries(o)) {
      if (k === AIRPORT_TERMINAL_STOP) this.r.problems.push(`${path}.${k}: reserved stop id (the generated airport terminal)`);
      out[k] = this.at(p, `${path}.${k}`);
    }
    if (Object.keys(out).length === 0) this.r.problems.push(`${path}: expected at least one stop`);
    return out;
  }

  /** A list of stop refs, each a key of `stops` or the airport terminal. */
  refs(v: unknown, path: string, stops: Record<string, Vec2>, min: number): string[] {
    const list = strList(this.r, v, path);
    if (list.length < min) this.r.problems.push(`${path}: needs at least ${min} stops`);
    for (const s of list) if (s !== AIRPORT_TERMINAL_STOP && !(s in stops)) this.r.problems.push(`${path}: unknown stop '${s}'`);
    return list;
  }
}

function parseProcedural(r: Reader, raw: unknown, bounds: { width: number; height: number }, landmarkIds: readonly string[], districtIds: readonly string[]): ProceduralSpec {
  const P = new ProcReader(r, bounds);
  const path = 'procedural';
  const o = P.sec(raw, path, ['cell', 'relief', 'lake', 'rivers', 'canal', 'airport', 'roads', 'suitability', 'towns', 'cover', 'transit', 'act1', 'landmarks', 'game'], ['districts', 'trails']) ?? {};
  const cell = o.cell === undefined ? NaN : P.num(o, 'cell', path, 'pos');
  const roads = parseProcRoads(P, o.roads, `${path}.roads`);
  const towns = parseProcTowns(P, o.towns, `${path}.towns`, roads.routes);
  const transit = parseProcTransit(P, o.transit, `${path}.transit`);
  return {
    cell,
    relief: parseProcRelief(P, o.relief, `${path}.relief`),
    lake: parseProcLake(P, o.lake, `${path}.lake`),
    rivers: parseProcRivers(P, o.rivers, `${path}.rivers`),
    canal: parseProcCanal(P, o.canal, `${path}.canal`),
    airport: parseProcAirport(P, o.airport, `${path}.airport`),
    roads,
    suitability: parseProcSuitability(P, o.suitability, `${path}.suitability`),
    towns,
    cover: parseProcCover(P, o.cover, `${path}.cover`),
    transit,
    districts: parseProcDistricts(P, o.districts, `${path}.districts`, roads.routes),
    act1: parseProcAct1(P, o.act1, `${path}.act1`, transit.lines, towns.items),
    landmarks: parseProcLandmarks(P, o.landmarks, `${path}.landmarks`, landmarkIds, roads.routes.map((r) => r.id)),
    trails: parseProcTrails(P, o.trails, `${path}.trails`),
    game: parseProcGame(P, o.game, `${path}.game`, towns.items, districtIds, bounds),
  };
}

function parseProcGame(P: ProcReader, raw: unknown, path: string, towns: readonly ProcTown[], districtIds: readonly string[], bounds: { width: number; height: number }): ProcGame {
  const o = P.sec(raw, path, ['district_cell', 'rect_margin', 'districts']) ?? {};
  const out: ProcGame = { districtCell: P.num(o, 'district_cell', path, 'pos'), rectMargin: P.num(o, 'rect_margin', path, 'nonneg'), districts: {} };
  if (out.districtCell > 0 && (bounds.width % out.districtCell !== 0 || bounds.height % out.districtCell !== 0)) {
    P.r.problems.push(`${path}.district_cell: ${out.districtCell} m must divide the bounds (${bounds.width} × ${bounds.height})`);
  }
  const sources = ['sea', 'lake', 'wild', 'airport', ...towns.map((t) => t.id)];
  const dp = `${path}.districts`;
  const d = P.sec(o.districts, dp, sources) ?? {};
  for (const src of sources) {
    const id = d[src];
    if (id === undefined) continue; // reported as missing by sec()
    if (typeof id !== 'string' || !districtIds.includes(id)) P.r.problems.push(`${dp}.${src}: unknown district "${String(id)}"`);
    else out.districts[src] = id;
  }
  return out;
}

function parseProcTrails(P: ProcReader, raw: unknown, path: string): TrailParams[] {
  if (raw === undefined) return [];
  const out = listOf(P.r, raw, path).flatMap((t, i): TrailParams[] => {
    const p = `${path}[${i}]`;
    const o = P.sec(t, p, ['id', 'from', 'to', 'width', 'max_grade', 'min_length', 'max_length']);
    if (!o) return [];
    const from = P.r.str(o, 'from', p);
    if (from !== '' && from !== AIRPORT_TERMINAL_STOP) P.r.problems.push(`${p}.from: expected ${AIRPORT_TERMINAL_STOP} (the landside of the generated terminal)`);
    const tp = `${p}.to`;
    const to = P.sec(o.to, tp, ['highest_within', 'margin', 'min_distance']) ?? {};
    const trail: TrailParams = {
      id: P.r.str(o, 'id', p),
      viewpoint: { highestWithin: P.num(to, 'highest_within', tp, 'pos'), margin: P.num(to, 'margin', tp, 'nonneg'), minDistance: P.num(to, 'min_distance', tp, 'nonneg') },
      width: P.num(o, 'width', p, 'pos'),
      maxGrade: P.num(o, 'max_grade', p, 'pos'),
      minLength: P.num(o, 'min_length', p, 'pos'),
      maxLength: P.num(o, 'max_length', p, 'pos'),
    };
    if (!(trail.maxLength >= trail.minLength)) P.r.problems.push(`${p}.max_length: must be >= min_length`);
    return [trail];
  });
  P.unique(out.map((t) => t.id), path);
  return out;
}

const AIRPORT_PARTS = ['terminal', 'apron'] as const;

function parseProcLandmarks(P: ProcReader, raw: unknown, path: string, landmarkIds: readonly string[], routeIds: readonly string[]): { id: string; rule: LandmarkRule }[] {
  const o = P.r.obj(raw, path);
  if (!o) return [];
  return Object.entries(o).flatMap(([id, v]): { id: string; rule: LandmarkRule }[] => {
    const p = `${path}.${id}`;
    if (!landmarkIds.includes(id)) P.r.problems.push(`${p}: unknown landmark (not in landmarks:)`);
    if (v === 'anchor') return [{ id, rule: { kind: 'anchor' } }];
    const m = P.r.obj(v, p);
    if (!m) return [];
    if ('on' in m) {
      // { on: crossing, route, feature: canal, tolerance }: where a generated route crosses a generated feature.
      P.r.exact(m, ['on', 'route', 'feature', 'tolerance'], p);
      if (m.on !== 'crossing') {
        P.r.problems.push(`${p}.on: expected crossing`);
        return [];
      }
      const route = P.r.str(m, 'route', p);
      if (route !== '' && !routeIds.includes(route)) P.r.problems.push(`${p}.route: unknown route "${route}" (not in procedural.roads.routes)`);
      if (m.feature !== 'canal') P.r.problems.push(`${p}.feature: expected canal`);
      return [{ id, rule: { kind: 'crossing', route, feature: 'canal', tolerance: P.num(m, 'tolerance', p, 'pos') } }];
    }
    const keys = Object.keys(m);
    if (keys.length !== 1 || !['along', 'steepest_within', 'airport'].includes(keys[0]!)) {
      P.r.problems.push(`${p}: expected anchor, { along: m }, { steepest_within: m }, { airport: ${AIRPORT_PARTS.join(' | ')} } or { on: crossing, route, feature: canal, tolerance: m }`);
      return [];
    }
    if (keys[0] === 'along') return [{ id, rule: { kind: 'along', metres: P.num(m, 'along', p, 'pos') } }];
    if (keys[0] === 'steepest_within') return [{ id, rule: { kind: 'steepest', within: P.num(m, 'steepest_within', p, 'pos') } }];
    const part = m.airport;
    if (!AIRPORT_PARTS.includes(part as never)) {
      P.r.problems.push(`${p}.airport: expected ${AIRPORT_PARTS.join(' | ')}`);
      return [];
    }
    return [{ id, rule: { kind: 'airport', part: part as 'terminal' | 'apron' } }];
  });
}

function parseProcAct1(P: ProcReader, raw: unknown, path: string, lines: readonly ProcLine[], towns: readonly ProcTown[]): ProcAct1 {
  const o = P.sec(raw, path, ['line', 'branch_to', 'anchor_at', 'town', 'barrio_radius', 'strip_half_width']) ?? {};
  const out: ProcAct1 = {
    line: P.r.str(o, 'line', path),
    branchTo: P.r.str(o, 'branch_to', path),
    branch: -1,
    anchorAt: P.num(o, 'anchor_at', path, 'frac'),
    town: P.r.str(o, 'town', path),
    townIndex: -1,
    barrioRadius: P.num(o, 'barrio_radius', path, 'pos'),
    stripHalfWidth: P.num(o, 'strip_half_width', path, 'pos'),
  };
  if (out.anchorAt === 0 || out.anchorAt === 1) P.r.problems.push(`${path}.anchor_at: must be strictly between 0 and 1`);
  const line = lines.find((l) => l.id === out.line);
  if (out.line !== '' && !line) P.r.problems.push(`${path}.line: unknown transit line "${out.line}"`);
  if (line && out.branchTo !== '') {
    const ending = line.branches.flatMap((b, i) => (b[b.length - 1] === out.branchTo ? [i] : []));
    if (ending.length !== 1) {
      P.r.problems.push(`${path}.branch_to: ${ending.length} branches of ${out.line} end at "${out.branchTo}" (expected exactly 1)`);
    } else out.branch = ending[0]!;
  }
  out.townIndex = towns.findIndex((t) => t.id === out.town);
  if (out.town !== '' && out.townIndex < 0) P.r.problems.push(`${path}.town: unknown town "${out.town}"`);
  return out;
}

function parseProcRelief(P: ProcReader, raw: unknown, path: string): ReliefParams {
  const keys = ['seed', 'background', 'zones', 'modulation', 'coast_taper', 'coast_wobble', 'erosion', 'peak', 'peak_quantile', 'sea_floor', 'hummocks'];
  const o = P.sec(raw, path, keys) ?? {};
  const zones = listOf(P.r, o.zones, `${path}.zones`).flatMap((z, i): UpliftZone[] => {
    const p = `${path}.zones[${i}]`;
    const kind = P.r.obj(z, p)?.kind;
    if (kind === 'line') {
      const zo = P.sec(z, p, ['id', 'kind', 'points', 'width', 'rate']);
      if (!zo) return [];
      return [{ id: P.r.str(zo, 'id', p), kind, points: P.ats(zo.points, `${p}.points`, 2), width: P.num(zo, 'width', p, 'pos'), rate: P.num(zo, 'rate', p, 'nonneg') }];
    }
    if (kind === 'disc') {
      const zo = P.sec(z, p, ['id', 'kind', 'at', 'radius', 'rate']);
      if (!zo) return [];
      return [{ id: P.r.str(zo, 'id', p), kind, at: P.at(zo.at, `${p}.at`), radius: P.num(zo, 'radius', p, 'pos'), rate: P.num(zo, 'rate', p, 'nonneg') }];
    }
    P.r.problems.push(`${p}.kind: expected line or disc`);
    return [];
  });
  P.unique(zones.map((z) => z.id), `${path}.zones`);
  const mp = `${path}.modulation`;
  const m = P.sec(o.modulation, mp, ['lo', 'hi', 'octaves', 'warp', 'grain_deg', 'grain_ratio']) ?? {};
  const lo = P.num(m, 'lo', mp, 'nonneg');
  const hi = P.num(m, 'hi', mp);
  if (!(hi > lo)) P.r.problems.push(`${mp}.hi: must be > lo`);
  const wp = `${path}.coast_wobble`;
  const wob = P.sec(o.coast_wobble, wp, ['amplitude', 'octaves']) ?? {};
  const ep = `${path}.erosion`;
  const er = P.sec(o.erosion, ep, ['iterations', 'k', 'm', 'dt', 'diffusion']) ?? {};
  const diffusion = P.num(er, 'diffusion', ep, 'nonneg');
  if (diffusion > 0.2) P.r.problems.push(`${ep}.diffusion: must be <= 0.2 (explicit step stability)`);
  const sp = `${path}.sea_floor`;
  const sf = P.sec(o.sea_floor, sp, ['shore', 'slope']) ?? {};
  const hp = `${path}.hummocks`;
  const hm = P.sec(o.hummocks, hp, ['amplitude', 'octaves', 'inland', 'max_slope']) ?? {};
  const peakQuantile = P.num(o, 'peak_quantile', path);
  if (!(peakQuantile > 0 && peakQuantile < 1)) P.r.problems.push(`${path}.peak_quantile: expected 0 < q < 1`);
  return {
    seed: P.num(o, 'seed', path),
    background: P.num(o, 'background', path, 'nonneg'),
    zones,
    modulation: {
      lo,
      hi,
      octaves: P.octaves(m.octaves, `${mp}.octaves`),
      warp: P.num(m, 'warp', mp, 'nonneg'),
      grainDeg: P.num(m, 'grain_deg', mp),
      grainRatio: P.num(m, 'grain_ratio', mp, 'pos'),
    },
    coastTaper: P.num(o, 'coast_taper', path, 'pos'),
    coastWobble: { amplitude: P.num(wob, 'amplitude', wp, 'nonneg'), octaves: P.octaves(wob.octaves, `${wp}.octaves`) },
    erosion: { iterations: P.num(er, 'iterations', ep, 'int1'), k: P.num(er, 'k', ep, 'pos'), m: P.num(er, 'm', ep, 'pos'), dt: P.num(er, 'dt', ep, 'pos'), diffusion },
    peak: P.num(o, 'peak', path, 'pos'),
    peakQuantile,
    seaFloor: { shore: P.num(sf, 'shore', sp, 'nonneg'), slope: P.num(sf, 'slope', sp, 'pos') },
    hummocks: {
      amplitude: P.num(hm, 'amplitude', hp, 'nonneg'),
      octaves: P.octaves(hm.octaves, `${hp}.octaves`),
      inland: P.span(hm.inland, `${hp}.inland`),
      maxSlope: P.num(hm, 'max_slope', hp, 'pos'),
    },
  };
}

function parseProcLake(P: ProcReader, raw: unknown, path: string): LakeParams {
  const o = P.sec(raw, path, ['dam_hint', 'snap_radius', 'min_inland', 'frame_margin', 'target_km2']) ?? {};
  return {
    damHint: P.at(o.dam_hint, `${path}.dam_hint`),
    snapRadius: P.num(o, 'snap_radius', path, 'pos'),
    minInland: P.num(o, 'min_inland', path, 'nonneg'),
    frameMargin: P.num(o, 'frame_margin', path, 'nonneg'),
    targetKm2: P.num(o, 'target_km2', path, 'pos'),
  };
}

function parseProcRivers(P: ProcReader, raw: unknown, path: string): RiverParams {
  const o = P.sec(raw, path, ['min_area_km2', 'width_per_sqrt_km2', 'max_width']) ?? {};
  return { minAreaKm2: P.num(o, 'min_area_km2', path, 'pos'), widthPerSqrtKm2: P.num(o, 'width_per_sqrt_km2', path, 'pos'), maxWidth: P.num(o, 'max_width', path, 'pos') };
}

function parseProcCanal(P: ProcReader, raw: unknown, path: string): CanalParams {
  const o = P.sec(raw, path, ['caribbean', 'pacific_locks', 'pacific', 'width', 'depth', 'dig_weight']) ?? {};
  return {
    caribbean: P.at(o.caribbean, `${path}.caribbean`),
    pacificLocks: P.at(o.pacific_locks, `${path}.pacific_locks`),
    pacific: P.at(o.pacific, `${path}.pacific`),
    width: P.num(o, 'width', path, 'pos'),
    depth: P.num(o, 'depth', path, 'pos'),
    digWeight: P.num(o, 'dig_weight', path, 'nonneg'),
  };
}

function parseProcAirport(P: ProcReader, raw: unknown, path: string): AirportParams {
  const keys = ['hint', 'radius', 'runway_length', 'runway_spacing', 'runway_width', 'margin', 'distance_weight', 'heading_range', 'apron', 'edge_margin', 'towards', 'culvert_penalty', 'grade_slope_max', 'grade_reach_max'];
  const o = P.sec(raw, path, keys) ?? {};
  const headingRange = P.span(o.heading_range, `${path}.heading_range`);
  if (!(headingRange[0] >= 0 && headingRange[1] <= 180)) P.r.problems.push(`${path}.heading_range: expected degrees within [0, 180]`);
  const ap = `${path}.apron`;
  const apron = P.sec(o.apron, ap, ['length', 'depth', 'building']) ?? {};
  const building = P.r.pair(apron.building, `${ap}.building`);
  if (!(building[0] > 0 && building[1] > 0)) P.r.problems.push(`${ap}.building: expected [length, depth] > 0`);
  const runwayWidth = P.num(o, 'runway_width', path, 'pos');
  const runwaySpacing = P.num(o, 'runway_spacing', path, 'pos');
  if (!(runwaySpacing > runwayWidth)) P.r.problems.push(`${path}.runway_spacing: must be > runway_width (runways would overlap)`);
  return {
    hint: P.at(o.hint, `${path}.hint`),
    radius: P.num(o, 'radius', path, 'pos'),
    runwayLength: P.num(o, 'runway_length', path, 'pos'),
    runwaySpacing,
    runwayWidth,
    margin: P.num(o, 'margin', path, 'nonneg'),
    distanceWeight: P.num(o, 'distance_weight', path, 'nonneg'),
    culvertPenalty: P.num(o, 'culvert_penalty', path, 'nonneg'),
    gradeSlopeMax: P.num(o, 'grade_slope_max', path, 'nonneg'),
    gradeReachMax: P.num(o, 'grade_reach_max', path, 'nonneg'),
    towards: P.at(o.towards, `${path}.towards`),
    headingRange,
    apron: { length: P.num(apron, 'length', ap, 'pos'), depth: P.num(apron, 'depth', ap, 'pos'), building },
    edgeMargin: P.num(o, 'edge_margin', path, 'nonneg'),
  };
}

const ROUTE_KINDS: readonly RouteSpec['kind'][] = ['highway', 'road', 'rail'];

function parseProcRoads(P: ProcReader, raw: unknown, path: string): ProceduralSpec['roads'] {
  const o = P.sec(raw, path, ['grade', 'bridge', 'sea_bridge', 'canal_bridge', 'reuse', 'stops', 'routes']) ?? {};
  const gp = `${path}.grade`;
  const g = P.sec(o.grade, gp, ROUTE_KINDS) ?? {};
  const grade = Object.fromEntries(
    ROUTE_KINDS.map((k) => {
      const kp = `${gp}.${k}`;
      const go = P.sec(g[k], kp, ['g0', 'k', 'max_grade']) ?? {};
      return [k, { g0: P.num(go, 'g0', kp, 'pos'), k: P.num(go, 'k', kp, 'pos'), maxGrade: P.num(go, 'max_grade', kp, 'pos') }];
    }),
  ) as RoadParams['grade'];
  const stops = P.stops(o.stops, `${path}.stops`);
  const routes = listOf(P.r, o.routes, `${path}.routes`).flatMap((raw2, i): ProcRoute[] => {
    const p = `${path}.routes[${i}]`;
    const ro = P.sec(raw2, p, ['id', 'kind', 'stops']);
    if (!ro) return [];
    const kind = P.r.str(ro, 'kind', p) as RouteSpec['kind'];
    if (!ROUTE_KINDS.includes(kind)) P.r.problems.push(`${p}.kind: expected ${ROUTE_KINDS.join(', ')}`);
    return [{ id: P.r.str(ro, 'id', p), kind, stops: P.refs(ro.stops, `${p}.stops`, stops, 2) }];
  });
  P.unique(routes.map((rt) => rt.id), `${path}.routes`);
  return {
    grade,
    bridge: P.num(o, 'bridge', path, 'pos'),
    seaBridge: P.num(o, 'sea_bridge', path, 'pos'),
    canalBridge: P.num(o, 'canal_bridge', path, 'pos'),
    reuse: P.num(o, 'reuse', path, 'pos'),
    stops,
    routes,
  };
}

function parseProcSuitability(P: ProcReader, raw: unknown, path: string): SuitabilityParams {
  const o = P.sec(raw, path, ['max_slope', 'height_band', 'coast_fade', 'coast_range', 'crossing']) ?? {};
  return {
    maxSlope: P.num(o, 'max_slope', path, 'pos'),
    heightBand: P.span(o.height_band, `${path}.height_band`),
    coastFade: P.num(o, 'coast_fade', path, 'frac'),
    coastRange: P.num(o, 'coast_range', path, 'pos'),
    crossing: P.num(o, 'crossing', path, 'frac'),
  };
}

function parseProcTowns(P: ProcReader, raw: unknown, path: string, routes: readonly ProcRoute[]): ProceduralSpec['towns'] {
  const o = P.sec(raw, path, ['road_discount', 'jitter', 'jitter_wavelength', 'min_suitability', 'seed_snap', 'seed', 'separation', 'airport_buffer', 'items']) ?? {};
  const items = listOf(P.r, o.items, `${path}.items`).flatMap((raw2, i): ProcTown[] => {
    const p = `${path}.items[${i}]`;
    const t = P.sec(raw2, p, ['id', 'target_km2'], ['seeds', 'seed_along', 'road_affinity', 'patches']);
    if (!t) return [];
    const town: ProcTown = { id: P.r.str(t, 'id', p), seeds: [], targetKm2: P.num(t, 'target_km2', p, 'pos') };
    if ((t.seeds === undefined) === (t.seed_along === undefined)) P.r.problems.push(`${p}: expected exactly one of seeds, seed_along`);
    if (t.seeds !== undefined) town.seeds = P.ats(t.seeds, `${p}.seeds`, 1);
    if (t.seed_along !== undefined) {
      const sp = `${p}.seed_along`;
      const sa = P.sec(t.seed_along, sp, ['route', 'from'], ['reach']);
      if (sa) {
        const along: { route: string; from: string; reach?: number } = { route: P.r.str(sa, 'route', sp), from: P.r.str(sa, 'from', sp) };
        if (sa.reach !== undefined) along.reach = P.num(sa, 'reach', sp, 'pos');
        const rt = routes.find((x) => x.id === along.route);
        if (!rt) P.r.problems.push(`${sp}.route: unknown route '${along.route}'`);
        else if (rt.kind === 'rail') P.r.problems.push(`${sp}.route: '${along.route}' is a railroad; towns grow along roads`);
        else if (along.from === AIRPORT_TERMINAL_STOP || !rt.stops.includes(along.from)) P.r.problems.push(`${sp}.from: '${along.from}' is not a named stop of route '${along.route}'`);
        town.seedAlong = along;
      }
    }
    if (t.road_affinity !== undefined) town.roadAffinity = P.num(t, 'road_affinity', p, 'pos');
    if (t.patches !== undefined) {
      const gp = `${p}.patches`;
      const g = P.sec(t.patches, gp, ['wavelength', 'threshold']);
      if (g) town.patches = { wavelength: P.num(g, 'wavelength', gp, 'pos'), threshold: P.num(g, 'threshold', gp, 'frac') };
    }
    return [town];
  });
  P.unique(items.map((t) => t.id), `${path}.items`);
  if (items.length > 254) P.r.problems.push(`${path}.items: at most 254 towns (owner ids are bytes)`);
  return {
    roadDiscount: P.num(o, 'road_discount', path, 'pos'),
    jitter: P.num(o, 'jitter', path, 'nonneg'),
    jitterWavelength: P.num(o, 'jitter_wavelength', path, 'pos'),
    minSuitability: P.num(o, 'min_suitability', path, 'frac'),
    seedSnap: P.num(o, 'seed_snap', path, 'nonneg'),
    seed: P.num(o, 'seed', path),
    separation: P.num(o, 'separation', path, 'nonneg'),
    airportBuffer: P.num(o, 'airport_buffer', path, 'nonneg'),
    items,
  };
}

const DISTRICT_DEFAULTS: DistrictParams = { transitWeight: 0.4, transitSigma: 450, coastWeight: 0.3, coastSigma: 500, accessFloor: 0.5, accessRange: 250, footprint: 0.25, airportCoreGap: 600, items: [] };

function parseProcDistricts(P: ProcReader, raw: unknown, path: string, routes: readonly ProcRoute[]): DistrictParams {
  if (raw === undefined) return DISTRICT_DEFAULTS;
  const o = P.sec(raw, path, ['transit_weight', 'transit_sigma', 'coast_weight', 'coast_sigma', 'access_floor', 'access_range', 'footprint', 'airport_core_gap', 'items']) ?? {};
  const items = listOf(P.r, o.items, `${path}.items`).flatMap((raw2, i): DistrictItem[] => {
    const p = `${path}.items[${i}]`;
    const t = P.sec(raw2, p, ['id', 'style', 'sigma', 'weight'], ['at', 'along', 'around']);
    if (!t) return [];
    const style = P.r.str(t, 'style', p) as DistrictItem['style'];
    if (!DISTRICT_STYLES.includes(style)) P.r.problems.push(`${p}.style: unknown style '${style}' (${DISTRICT_STYLES.join(', ')})`);
    const where = ['at', 'along', 'around'].filter((k) => t[k] !== undefined);
    if (where.length !== 1) P.r.problems.push(`${p}: expected exactly one of at, along, around`);
    const out: { -readonly [K in keyof DistrictItem]: DistrictItem[K] } = { id: P.r.str(t, 'id', p), style, sigma: P.num(t, 'sigma', p, 'pos'), weight: P.num(t, 'weight', p) };
    if (!(out.weight >= -1 && out.weight <= 1)) P.r.problems.push(`${p}.weight: expected a number in [-1, 1]`);
    if (t.at !== undefined) out.at = P.at(t.at, `${p}.at`);
    if (t.along !== undefined) {
      out.along = P.r.str(t, 'along', p);
      const rt = routes.find((x) => x.id === out.along);
      if (!rt) P.r.problems.push(`${p}.along: unknown route '${out.along}'`);
      else if (rt.kind === 'rail') P.r.problems.push(`${p}.along: '${out.along}' is a railroad; districts follow roads`);
    }
    if (t.around !== undefined) {
      if (t.around !== 'airport') P.r.problems.push(`${p}.around: only 'airport' is supported`);
      out.around = 'airport';
    }
    return [out];
  });
  P.unique(items.map((t) => t.id), `${path}.items`);
  return {
    transitWeight: P.num(o, 'transit_weight', path, 'frac'),
    transitSigma: P.num(o, 'transit_sigma', path, 'pos'),
    coastWeight: P.num(o, 'coast_weight', path, 'nonneg'),
    coastSigma: P.num(o, 'coast_sigma', path, 'pos'),
    accessFloor: P.num(o, 'access_floor', path, 'frac'),
    accessRange: P.num(o, 'access_range', path, 'pos'),
    footprint: P.num(o, 'footprint', path, 'frac'),
    airportCoreGap: P.num(o, 'airport_core_gap', path, 'nonneg'),
    items,
  };
}

function parseProcCover(P: ProcReader, raw: unknown, path: string): CoverParams {
  const o = P.sec(raw, path, ['seed', 'beach_width', 'mangrove', 'clearing', 'high_forest']) ?? {};
  const mp = `${path}.mangrove`;
  const m = P.sec(o.mangrove, mp, ['max_height', 'river_area_km2', 'reach']) ?? {};
  const cp = `${path}.clearing`;
  const c = P.sec(o.clearing, cp, ['wavelength', 'threshold', 'lowland_bonus', 'fringe_bonus']) ?? {};
  const hp = `${path}.high_forest`;
  const h = P.sec(o.high_forest, hp, ['height', 'slope']) ?? {};
  return {
    seed: P.num(o, 'seed', path),
    beachWidth: P.num(o, 'beach_width', path, 'nonneg'),
    mangrove: { maxHeight: P.num(m, 'max_height', mp, 'pos'), riverAreaKm2: P.num(m, 'river_area_km2', mp, 'pos'), reach: P.num(m, 'reach', mp, 'nonneg') },
    clearing: {
      wavelength: P.num(c, 'wavelength', cp, 'pos'),
      threshold: P.num(c, 'threshold', cp, 'frac'),
      lowlandBonus: P.num(c, 'lowland_bonus', cp, 'nonneg'),
      fringeBonus: P.num(c, 'fringe_bonus', cp, 'nonneg'),
    },
    highForest: { height: P.num(h, 'height', hp, 'pos'), slope: P.num(h, 'slope', hp, 'pos') },
  };
}

const LINE_MODES: readonly TransitLineSpec['mode'][] = ['metro', 'rail'];

function parseProcTransit(P: ProcReader, raw: unknown, path: string): ProceduralSpec['transit'] {
  const o = P.sec(raw, path, ['stops', 'lines', 'off_urban', 'off_road', 'grade', 'bridge', 'interchange_radius']) ?? {};
  const stops = P.stops(o.stops, `${path}.stops`);
  const lines = listOf(P.r, o.lines, `${path}.lines`).flatMap((raw2, i): ProcLine[] => {
    const p = `${path}.lines[${i}]`;
    const l = P.sec(raw2, p, ['id', 'name', 'mode', 'color', 'branches', 'station_spacing']);
    if (!l) return [];
    const mode = P.r.str(l, 'mode', p) as TransitLineSpec['mode'];
    if (!LINE_MODES.includes(mode)) P.r.problems.push(`${p}.mode: expected ${LINE_MODES.join(', ')}`);
    const col = l.color;
    const color: [number, number, number] = Array.isArray(col) && col.length === 3 && col.every((c) => Number.isInteger(c) && c >= 0 && c <= 255) ? [col[0], col[1], col[2]] : [NaN, NaN, NaN];
    if (Number.isNaN(color[0])) P.r.problems.push(`${p}.color: expected [r, g, b] integers 0-255`);
    const branches = listOf(P.r, l.branches, `${p}.branches`).map((b, j) => P.refs(b, `${p}.branches[${j}]`, stops, 2));
    if (branches.length === 0) P.r.problems.push(`${p}.branches: expected at least one branch`);
    return [{ id: P.r.str(l, 'id', p), name: P.r.str(l, 'name', p), mode, color, branches, stationSpacing: P.num(l, 'station_spacing', p, 'pos') }];
  });
  P.unique(lines.map((l) => l.id), `${path}.lines`);
  const gp = `${path}.grade`;
  const g = P.sec(o.grade, gp, LINE_MODES) ?? {};
  return {
    stops,
    lines,
    offUrban: P.num(o, 'off_urban', path, 'pos'),
    offRoad: P.num(o, 'off_road', path, 'pos'),
    grade: { metro: P.num(g, 'metro', gp, 'pos'), rail: P.num(g, 'rail', gp, 'pos') },
    bridge: P.num(o, 'bridge', path, 'pos'),
    interchangeRadius: P.num(o, 'interchange_radius', path, 'pos'),
  };
}
