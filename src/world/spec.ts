import { load } from 'js-yaml';
import type { Vec2 } from './vec.ts';
import { pointInPolygon } from './geometry.ts';

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
  /** m per storey. */
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
  /** Layer 1: land cover (land_cover:). */
  landCover: LandCoverSpec;
  /** Layer 3a: rivers (rivers:). */
  rivers: RiversSpec;
  /** Layer 3b: canal channel and locks (canal:). */
  canal: CanalSpec;
  /** Layer 3b: interior water polygons (water_bodies:). */
  waterBodies: WaterBody[];
  /** Layer 4: airports (airports:). */
  airports: AirportSpec[];
  /** Layer 5: main roads (main_roads:). */
  mainRoads: MainRoadsSpec;
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

function parseFrontageLots(r: Reader, v: unknown, path: string): FrontageLots | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const unit = (key: string): number => {
    const x = r.num(o, key, path);
    if (!(x >= 0 && x <= 1)) r.problems.push(`${path}.${key}: must be in [0, 1]`);
    return x;
  };
  const levelHeight = r.num(o, 'level_height', path);
  if (!(levelHeight > 0)) r.problems.push(`${path}.level_height: must be > 0`);
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
    levelHeight,
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
        if (method === 'frontage-lots') district.frontageLots = parseFrontageLots(r, o.frontage_lots, `${path}.frontage_lots`);
        else if (o.frontage_lots !== undefined) r.problems.push(`${path}.frontage_lots: only valid with method "frontage-lots"`);
        blockout.districts[id] = district;
      }
    }
  }

  const streetStyles = parseStreetStyles(r, doc.street_styles, districts, grid, bounds, activeArea);
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

  const landCover = parseLandCover(r, doc.land_cover);
  const rivers = parseRivers(r, doc.rivers);
  const canal = parseCanal(r, doc.canal);
  const waterBodies = parseWaterBodies(r, doc.water_bodies);
  const airports = parseAirports(r, doc.airports);
  const mainRoads = parseMainRoads(r, doc.main_roads);

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
    landCover,
    rivers,
    canal,
    waterBodies,
    airports,
    mainRoads,
  };
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
// relief (terrain height model). Semantics: README.md "Relief"; model: src/world/terrain.ts.

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
// Layers 1-5 (whole isthmus). Semantics: README.md "Layers"; code: src/world/layers/.
// These sections are parsed strictly: an unknown key is an error.

export interface LandCoverSpec {
  seed: number;
  classes: string[];
  /** Coast inside each rect (corners [[minX, minY], [maxX, maxY]], m) is tidal. */
  tidalShores: { id: string; rect: Rect2 }[];
  mangrove: { band: number; shores: string[] };
  forest: { density: number; noise: { wavelength: number; octaves: number; persistence: number }; clearingBelow: number };
  settlements: { id: string; at: Vec2; radius: number; inspiredBy?: string }[];
  /** Layer 1b re-mask after relief and rivers. */
  refine: { bareSlope: number; waterMargin: number };
  /** Planned shares of land, [min, max] as fractions. */
  shares: { urban: Range; wetland: Range };
}

export type Rect2 = { minX: number; minY: number; maxX: number; maxY: number };

export interface RiverOutlet {
  id: string;
  inspiredBy?: string;
  /** Shoreline point, m: of geometry.land (coast outlet, the default) or of `outlet.waterBody`. */
  mouth: Vec2;
  /** Lake-fed river: the mouth lies on the shore of this water body instead of the coast. */
  outlet?: { waterBody: string };
  /** Optional low-cost corridor points the derived course follows, m. */
  guide: Vec2[];
}

export interface RiversSpec {
  seed: number;
  accumulationMinKm2: number;
  maxWidth: number;
  mouthTolerance: number;
  items: RiverOutlet[];
}

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

export interface WaterBody {
  id: string;
  kind: 'lake' | 'inlet';
  inspiredBy?: string;
  polygon: Vec2[];
  /** Inlet only: the lake it belongs to. */
  of?: string;
  /** Lake only: islands generated inside the polygon. */
  islands?: { seed: number; count: number };
}

export interface AirportSpec {
  id: string;
  inspiredBy?: string;
  /** routes ids of kind runway. */
  runways: string[];
  runwayLength: number;
  runwaySpacing: number;
  terminal: string;
  cargo: string;
  /** relief.flatten id that levels the site. */
  flatten: string;
  taxiway: { width: number };
}

export type RoadClass = 'highway' | 'arterial';
export type MainNodeKind = 'hub' | 'gateway' | 'junction' | 'waypoint' | 'landfall';

export interface MainNode {
  id: string;
  at: Vec2;
  kind: MainNodeKind;
  landmark?: string;
  inspiredBy?: string;
}

export interface BridgeDecl {
  id: string;
  /** 'canal' or a water_bodies id. */
  over: string;
  at: Vec2;
  /** m, deck length including abutments. */
  span: number;
  landmark?: string;
}

export interface MainRoad {
  id: string;
  inspiredBy?: string;
  class: RoadClass;
  structure: 'at-grade' | 'viaduct';
  /** Overrides main_roads.params.max_grade[class]. */
  maxGrade?: number;
  elevated: boolean;
  /** routes ids this road replaces once the layer is implemented. */
  supersedes: string[];
  /** Node ids, in order; each consecutive pair is an edge. */
  chain: string[];
  bridges: BridgeDecl[];
}

export interface MainRoadsSpec {
  params: {
    maxGrade: Record<RoadClass, number>;
    cost: { k: number; s0: number };
    minInterchange: number;
    bridge: { abutment: number; canalClearance: number; riverClearance: number };
    viaduct: { offset: Range; deckAboveSea: number; pierSpacing: number };
    sampleStep: number;
  };
  nodes: MainNode[];
  roads: MainRoad[];
  coastway: {
    id: string;
    boulevard: string;
    viaduct: { road: string; side: 'bay'; around: string };
    strip: { kind: string; capHeight: number; polygon: Vec2[] };
  };
}

const blankRect = (): Rect2 => ({ minX: NaN, minY: NaN, maxX: NaN, maxY: NaN });
const nan2: Range = [NaN, NaN];

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

function rectOf(r: Reader, v: unknown, path: string): Rect2 {
  const pts = r.points(v, path, 2);
  if (pts.length !== 2) {
    r.problems.push(`${path}: expected [[minX, minY], [maxX, maxY]]`);
    return blankRect();
  }
  const [a, b] = pts as [Vec2, Vec2];
  if (!(a.x < b.x && a.y < b.y)) r.problems.push(`${path}: min corner must be south-west of max corner`);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

function fraction(r: Reader, v: number, path: string): number {
  if (!(v >= 0 && v <= 1)) r.problems.push(`${path}: expected a fraction in [0, 1]`);
  return v;
}

function positive(r: Reader, v: number, path: string): number {
  if (!(v > 0)) r.problems.push(`${path}: must be > 0`);
  return v;
}

function bandOf(r: Reader, v: unknown, path: string): Range {
  const [min, max] = r.pair(v, path);
  if (!(min >= 0 && min < max && max <= 1)) r.problems.push(`${path}: expected [min, max] fractions with 0 <= min < max <= 1`);
  return [min, max];
}

function parseLandCover(r: Reader, raw: unknown): LandCoverSpec {
  const path = 'land_cover';
  const empty: LandCoverSpec = {
    seed: NaN,
    classes: [],
    tidalShores: [],
    mangrove: { band: NaN, shores: [] },
    forest: { density: NaN, noise: { wavelength: NaN, octaves: NaN, persistence: NaN }, clearingBelow: NaN },
    settlements: [],
    refine: { bareSlope: NaN, waterMargin: NaN },
    shares: { urban: nan2, wetland: nan2 },
  };
  const o = r.obj(raw, path);
  if (!o) return empty;
  r.exact(o, ['seed', 'classes', 'tidal_shores', 'mangrove', 'forest', 'settlements', 'refine', 'shares'], path);
  const out = { ...empty };
  out.seed = r.num(o, 'seed', path);
  out.classes = strList(r, o.classes, `${path}.classes`);
  out.tidalShores = listOf(r, o.tidal_shores, `${path}.tidal_shores`).flatMap((raw2, i) => {
    const p = `${path}.tidal_shores[${i}]`;
    const t = r.obj(raw2, p);
    if (!t) return [];
    r.exact(t, ['id', 'rect'], p);
    return [{ id: r.str(t, 'id', p), rect: rectOf(r, t.rect, `${p}.rect`) }];
  });
  const mg = r.obj(o.mangrove, `${path}.mangrove`);
  if (mg) {
    r.exact(mg, ['band', 'shores'], `${path}.mangrove`);
    out.mangrove = { band: positive(r, r.num(mg, 'band', `${path}.mangrove`), `${path}.mangrove.band`), shores: strList(r, mg.shores, `${path}.mangrove.shores`) };
    const ids = new Set(out.tidalShores.map((t) => t.id));
    for (const sid of out.mangrove.shores) if (!ids.has(sid)) r.problems.push(`${path}.mangrove.shores: unknown tidal shore "${sid}"`);
  }
  const fo = r.obj(o.forest, `${path}.forest`);
  if (fo) {
    const p = `${path}.forest`;
    r.exact(fo, ['density', 'noise', 'clearing_below'], p);
    const nz = r.obj(fo.noise, `${p}.noise`);
    const noise = { wavelength: NaN, octaves: NaN, persistence: NaN };
    if (nz) {
      r.exact(nz, ['wavelength', 'octaves', 'persistence'], `${p}.noise`);
      noise.wavelength = positive(r, r.num(nz, 'wavelength', `${p}.noise`), `${p}.noise.wavelength`);
      noise.octaves = r.num(nz, 'octaves', `${p}.noise`);
      if (!Number.isInteger(noise.octaves) || noise.octaves < 1 || noise.octaves > 8) r.problems.push(`${p}.noise.octaves: expected an integer in [1, 8]`);
      noise.persistence = r.num(nz, 'persistence', `${p}.noise`);
      if (!(noise.persistence > 0 && noise.persistence < 1)) r.problems.push(`${p}.noise.persistence: expected a number in (0, 1)`);
    }
    out.forest = { density: fraction(r, r.num(fo, 'density', p), `${p}.density`), noise, clearingBelow: fraction(r, r.num(fo, 'clearing_below', p), `${p}.clearing_below`) };
  }
  out.settlements = listOf(r, o.settlements, `${path}.settlements`).flatMap((raw2, i) => {
    const p = `${path}.settlements[${i}]`;
    const st = r.obj(raw2, p);
    if (!st) return [];
    r.exact(st, ['id', 'at', 'radius', 'inspired_by'], p);
    const s: LandCoverSpec['settlements'][number] = { id: r.str(st, 'id', p), at: r.point(st.at, `${p}.at`), radius: positive(r, r.num(st, 'radius', p), `${p}.radius`) };
    const ins = r.optStr(st, 'inspired_by', p);
    if (ins !== undefined) s.inspiredBy = ins;
    return [s];
  });
  const rf = r.obj(o.refine, `${path}.refine`);
  if (rf) {
    r.exact(rf, ['bare_slope', 'water_margin'], `${path}.refine`);
    out.refine = { bareSlope: positive(r, r.num(rf, 'bare_slope', `${path}.refine`), `${path}.refine.bare_slope`), waterMargin: r.num(rf, 'water_margin', `${path}.refine`) };
    if (out.refine.waterMargin < 0) r.problems.push(`${path}.refine.water_margin: must be >= 0`);
  }
  const sh = r.obj(o.shares, `${path}.shares`);
  if (sh) {
    r.exact(sh, ['urban', 'wetland'], `${path}.shares`);
    out.shares = { urban: bandOf(r, sh.urban, `${path}.shares.urban`), wetland: bandOf(r, sh.wetland, `${path}.shares.wetland`) };
  }
  return out;
}

function parseRivers(r: Reader, raw: unknown): RiversSpec {
  const path = 'rivers';
  const out: RiversSpec = { seed: NaN, accumulationMinKm2: NaN, maxWidth: NaN, mouthTolerance: NaN, items: [] };
  const o = r.obj(raw, path);
  if (!o) return out;
  r.exact(o, ['seed', 'accumulation_min_km2', 'max_width', 'mouth_tolerance', 'items'], path);
  out.seed = r.num(o, 'seed', path);
  out.accumulationMinKm2 = positive(r, r.num(o, 'accumulation_min_km2', path), `${path}.accumulation_min_km2`);
  out.maxWidth = positive(r, r.num(o, 'max_width', path), `${path}.max_width`);
  out.mouthTolerance = positive(r, r.num(o, 'mouth_tolerance', path), `${path}.mouth_tolerance`);
  out.items = listOf(r, o.items, `${path}.items`).flatMap((raw2, i) => {
    const p = `${path}.items[${i}]`;
    const it = r.obj(raw2, p);
    if (!it) return [];
    r.exact(it, ['id', 'inspired_by', 'mouth', 'outlet', 'guide'], p);
    const river: RiverOutlet = {
      id: r.str(it, 'id', p),
      mouth: r.point(it.mouth, `${p}.mouth`),
      guide: it.guide === undefined ? [] : r.points(it.guide, `${p}.guide`, 0),
    };
    const ins = r.optStr(it, 'inspired_by', p);
    if (ins !== undefined) river.inspiredBy = ins;
    if (it.outlet !== undefined) {
      const ot = r.obj(it.outlet, `${p}.outlet`);
      if (ot) {
        r.exact(ot, ['water_body'], `${p}.outlet`);
        river.outlet = { waterBody: r.str(ot, 'water_body', `${p}.outlet`) };
      }
    }
    return [river];
  });
  return out;
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

function parseWaterBodies(r: Reader, raw: unknown): WaterBody[] {
  return listOf(r, raw, 'water_bodies').flatMap((raw2, i) => {
    const p = `water_bodies[${i}]`;
    const b = r.obj(raw2, p);
    if (!b) return [];
    r.exact(b, ['id', 'kind', 'inspired_by', 'polygon', 'of', 'islands'], p);
    const kind = r.str(b, 'kind', p);
    if (kind !== '' && kind !== 'lake' && kind !== 'inlet') r.problems.push(`${p}.kind: expected "lake" or "inlet"`);
    const body: WaterBody = { id: r.str(b, 'id', p), kind: kind === 'inlet' ? 'inlet' : 'lake', polygon: r.points(b.polygon, `${p}.polygon`, 3) };
    const ins = r.optStr(b, 'inspired_by', p);
    if (ins !== undefined) body.inspiredBy = ins;
    if (body.kind === 'inlet') {
      body.of = r.str(b, 'of', p);
      if (b.islands !== undefined) r.problems.push(`${p}.islands: only valid on a lake`);
    } else {
      if (b.of !== undefined) r.problems.push(`${p}.of: only valid on an inlet`);
      if (b.islands !== undefined) {
        const isl = r.obj(b.islands, `${p}.islands`);
        if (isl) {
          r.exact(isl, ['seed', 'count'], `${p}.islands`);
          body.islands = { seed: r.num(isl, 'seed', `${p}.islands`), count: r.num(isl, 'count', `${p}.islands`) };
        }
      }
    }
    return [body];
  });
}

function parseAirports(r: Reader, raw: unknown): AirportSpec[] {
  return listOf(r, raw, 'airports').flatMap((raw2, i) => {
    const p = `airports[${i}]`;
    const a = r.obj(raw2, p);
    if (!a) return [];
    r.exact(a, ['id', 'inspired_by', 'runways', 'runway_length', 'runway_spacing', 'terminal', 'cargo', 'flatten', 'taxiway'], p);
    const tw = r.obj(a.taxiway, `${p}.taxiway`);
    if (tw) r.exact(tw, ['width'], `${p}.taxiway`);
    const ap: AirportSpec = {
      id: r.str(a, 'id', p),
      runways: strList(r, a.runways, `${p}.runways`),
      runwayLength: positive(r, r.num(a, 'runway_length', p), `${p}.runway_length`),
      runwaySpacing: positive(r, r.num(a, 'runway_spacing', p), `${p}.runway_spacing`),
      terminal: r.str(a, 'terminal', p),
      cargo: r.str(a, 'cargo', p),
      flatten: r.str(a, 'flatten', p),
      taxiway: { width: tw ? positive(r, r.num(tw, 'width', `${p}.taxiway`), `${p}.taxiway.width`) : NaN },
    };
    const ins = r.optStr(a, 'inspired_by', p);
    if (ins !== undefined) ap.inspiredBy = ins;
    return [ap];
  });
}

const MAIN_NODE_KINDS: readonly string[] = ['hub', 'gateway', 'junction', 'waypoint', 'landfall'];
const ROAD_CLASSES: readonly string[] = ['highway', 'arterial'];

function parseMainRoads(r: Reader, raw: unknown): MainRoadsSpec {
  const path = 'main_roads';
  const out: MainRoadsSpec = {
    params: {
      maxGrade: { highway: NaN, arterial: NaN },
      cost: { k: NaN, s0: NaN },
      minInterchange: NaN,
      bridge: { abutment: NaN, canalClearance: NaN, riverClearance: NaN },
      viaduct: { offset: nan2, deckAboveSea: NaN, pierSpacing: NaN },
      sampleStep: NaN,
    },
    nodes: [],
    roads: [],
    coastway: { id: '', boulevard: '', viaduct: { road: '', side: 'bay', around: '' }, strip: { kind: '', capHeight: NaN, polygon: [] } },
  };
  const o = r.obj(raw, path);
  if (!o) return out;
  r.exact(o, ['params', 'nodes', 'roads', 'coastway'], path);

  const pr = r.obj(o.params, `${path}.params`);
  if (pr) {
    const pp = `${path}.params`;
    r.exact(pr, ['max_grade', 'cost', 'min_interchange', 'bridge', 'viaduct', 'sample_step'], pp);
    const mg = r.obj(pr.max_grade, `${pp}.max_grade`);
    if (mg) {
      r.exact(mg, ROAD_CLASSES, `${pp}.max_grade`);
      for (const c of ['highway', 'arterial'] as const) {
        const v = r.num(mg, c, `${pp}.max_grade`);
        if (!(v > 0 && v < 1)) r.problems.push(`${pp}.max_grade.${c}: expected a grade in (0, 1)`);
        out.params.maxGrade[c] = v;
      }
    }
    const cs = r.obj(pr.cost, `${pp}.cost`);
    if (cs) {
      r.exact(cs, ['k', 's0'], `${pp}.cost`);
      out.params.cost = { k: r.num(cs, 'k', `${pp}.cost`), s0: positive(r, r.num(cs, 's0', `${pp}.cost`), `${pp}.cost.s0`) };
    }
    out.params.minInterchange = positive(r, r.num(pr, 'min_interchange', pp), `${pp}.min_interchange`);
    const br = r.obj(pr.bridge, `${pp}.bridge`);
    if (br) {
      r.exact(br, ['abutment', 'canal_clearance', 'river_clearance'], `${pp}.bridge`);
      out.params.bridge = {
        abutment: r.num(br, 'abutment', `${pp}.bridge`),
        canalClearance: r.num(br, 'canal_clearance', `${pp}.bridge`),
        riverClearance: r.num(br, 'river_clearance', `${pp}.bridge`),
      };
    }
    const vd = r.obj(pr.viaduct, `${pp}.viaduct`);
    if (vd) {
      r.exact(vd, ['offset', 'deck_above_sea', 'pier_spacing'], `${pp}.viaduct`);
      const offset = r.pair(vd.offset, `${pp}.viaduct.offset`);
      if (!(offset[0] > 0 && offset[0] < offset[1])) r.problems.push(`${pp}.viaduct.offset: expected [min, max] with 0 < min < max`);
      out.params.viaduct = {
        offset,
        deckAboveSea: r.num(vd, 'deck_above_sea', `${pp}.viaduct`),
        pierSpacing: positive(r, r.num(vd, 'pier_spacing', `${pp}.viaduct`), `${pp}.viaduct.pier_spacing`),
      };
    }
    out.params.sampleStep = positive(r, r.num(pr, 'sample_step', pp), `${pp}.sample_step`);
  }

  const seenNodes = new Set<string>();
  out.nodes = listOf(r, o.nodes, `${path}.nodes`).flatMap((raw2, i) => {
    const p = `${path}.nodes[${i}]`;
    const n = r.obj(raw2, p);
    if (!n) return [];
    r.exact(n, ['id', 'at', 'kind', 'landmark', 'inspired_by'], p);
    const kind = r.str(n, 'kind', p);
    if (kind !== '' && !MAIN_NODE_KINDS.includes(kind)) r.problems.push(`${p}.kind: expected one of ${MAIN_NODE_KINDS.join(', ')}`);
    const node: MainNode = { id: r.str(n, 'id', p), at: r.point(n.at, `${p}.at`), kind: kind as MainNodeKind };
    if (seenNodes.has(node.id)) r.problems.push(`${p}.id: duplicate node "${node.id}"`);
    seenNodes.add(node.id);
    const lm = r.optStr(n, 'landmark', p);
    if (lm !== undefined) node.landmark = lm;
    const ins = r.optStr(n, 'inspired_by', p);
    if (ins !== undefined) node.inspiredBy = ins;
    return [node];
  });

  const seenRoads = new Set<string>();
  out.roads = listOf(r, o.roads, `${path}.roads`).flatMap((raw2, i) => {
    const p = `${path}.roads[${i}]`;
    const rd = r.obj(raw2, p);
    if (!rd) return [];
    r.exact(rd, ['id', 'inspired_by', 'class', 'structure', 'max_grade', 'elevated', 'supersedes', 'chain', 'bridges'], p);
    const cls = r.str(rd, 'class', p);
    if (cls !== '' && !ROAD_CLASSES.includes(cls)) r.problems.push(`${p}.class: expected highway or arterial`);
    const structure = rd.structure ?? 'at-grade';
    if (structure !== 'at-grade' && structure !== 'viaduct') r.problems.push(`${p}.structure: expected "at-grade" or "viaduct"`);
    const chain = strList(r, rd.chain, `${p}.chain`);
    if (chain.length < 2) r.problems.push(`${p}.chain: needs at least 2 nodes`);
    for (const nid of chain) if (!seenNodes.has(nid)) r.problems.push(`${p}.chain: unknown node "${nid}"`);
    const road: MainRoad = {
      id: r.str(rd, 'id', p),
      class: cls as RoadClass,
      structure: structure === 'viaduct' ? 'viaduct' : 'at-grade',
      elevated: rd.elevated === true,
      supersedes: rd.supersedes === undefined ? [] : strList(r, rd.supersedes, `${p}.supersedes`),
      chain,
      bridges: [],
    };
    if (seenRoads.has(road.id)) r.problems.push(`${p}.id: duplicate road "${road.id}"`);
    seenRoads.add(road.id);
    const mg = r.optNum(rd, 'max_grade', p);
    if (mg !== undefined) {
      if (!(mg > 0 && mg < 1)) r.problems.push(`${p}.max_grade: expected a grade in (0, 1)`);
      road.maxGrade = mg;
    }
    const ins = r.optStr(rd, 'inspired_by', p);
    if (ins !== undefined) road.inspiredBy = ins;
    if (rd.bridges !== undefined) {
      road.bridges = listOf(r, rd.bridges, `${p}.bridges`).flatMap((raw3, j) => {
        const bp = `${p}.bridges[${j}]`;
        const b = r.obj(raw3, bp);
        if (!b) return [];
        r.exact(b, ['id', 'over', 'at', 'span', 'landmark'], bp);
        const bridge: BridgeDecl = { id: r.str(b, 'id', bp), over: r.str(b, 'over', bp), at: r.point(b.at, `${bp}.at`), span: positive(r, r.num(b, 'span', bp), `${bp}.span`) };
        const lm = r.optStr(b, 'landmark', bp);
        if (lm !== undefined) bridge.landmark = lm;
        return [bridge];
      });
    }
    return [road];
  });

  const co = r.obj(o.coastway, `${path}.coastway`);
  if (co) {
    const cp = `${path}.coastway`;
    r.exact(co, ['id', 'boulevard', 'viaduct', 'strip'], cp);
    const vi = r.obj(co.viaduct, `${cp}.viaduct`);
    let viaduct = out.coastway.viaduct;
    if (vi) {
      r.exact(vi, ['road', 'side', 'around'], `${cp}.viaduct`);
      if (vi.side !== 'bay') r.problems.push(`${cp}.viaduct.side: only "bay" is allowed (the map has no sea south of the old quarter)`);
      viaduct = { road: r.str(vi, 'road', `${cp}.viaduct`), side: 'bay', around: r.str(vi, 'around', `${cp}.viaduct`) };
    }
    const st = r.obj(co.strip, `${cp}.strip`);
    let strip = out.coastway.strip;
    if (st) {
      r.exact(st, ['kind', 'cap_height', 'polygon'], `${cp}.strip`);
      strip = { kind: r.str(st, 'kind', `${cp}.strip`), capHeight: r.num(st, 'cap_height', `${cp}.strip`), polygon: r.points(st.polygon, `${cp}.strip.polygon`, 3) };
    }
    out.coastway = { id: r.str(co, 'id', cp), boulevard: r.str(co, 'boulevard', cp), viaduct, strip };
    if (out.coastway.boulevard !== '' && !seenRoads.has(out.coastway.boulevard)) r.problems.push(`${cp}.boulevard: unknown road "${out.coastway.boulevard}"`);
    const vr = out.roads.find((x) => x.id === viaduct.road);
    if (viaduct.road !== '' && (!vr || vr.structure !== 'viaduct')) r.problems.push(`${cp}.viaduct.road: "${viaduct.road}" is not a road with structure: viaduct`);
  }
  return out;
}
