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

export interface BlockoutDistrict {
  lot: number;
  footprint: Range;
  height: Range;
  setback: number;
  fill: number;
  angle: number;
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
        blockout.districts[id] = {
          lot: r.num(o, 'lot', path),
          footprint: r.pair(o.footprint, `${path}.footprint`),
          height: r.pair(o.height, `${path}.height`),
          setback: r.num(o, 'setback', path),
          fill: r.num(o, 'fill', path),
          angle: r.num(o, 'angle', path),
        };
      }
    }
  }

  const streetStyles = parseStreetStyles(r, doc.street_styles, districts, grid, bounds, activeArea);

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
