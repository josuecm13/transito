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
  walkOn: string[];
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
      pedestrians.walkOn = pedRaw.walk_on as string[];
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
    population: { pedestrians },
  };
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
