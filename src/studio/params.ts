/**
 * What `describe` tells an agent and what `validate` enforces beyond the strict parser: ranges, units and a
 * plain-language explanation per editable parameter. Structure and cross-references (stop ids, route ids,
 * unknown keys) stay with the parser in src/world/spec.ts — the single validated source — so this table
 * only adds bounds. A guard test fails when an entry names a path the config doesn't have.
 */
import type { Json } from './paths.ts';

export interface ParamDoc {
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
  readonly integer?: boolean;
  readonly desc: string;
}

/** Keys use `[*]` for any list entry. */
export const PARAM_DOCS: Readonly<Record<string, ParamDoc>> = {
  'procedural.cell': { min: 10, max: 80, unit: 'm', desc: 'Generation grid cell. Smaller is sharper and slower; 40 m is a good coarse preview.' },
  'procedural.relief.seed': { integer: true, min: 0, max: 99999, desc: 'Seed of the relief noise: a different mountain layout over the same ridges.' },
  'procedural.relief.background': { min: 0, max: 0.3, desc: 'Uplift away from every ridge zone. Higher makes the lowlands hillier.' },
  'procedural.relief.zones[*].width': { min: 200, max: 4000, unit: 'm', desc: 'Width of a ridge zone (line zones). Wider ranges raise a broader mass and move watersheds.' },
  'procedural.relief.zones[*].rate': { min: 0, max: 2, desc: 'Uplift strength of a ridge zone. Higher is a taller ridge after erosion.' },
  'procedural.relief.zones[*].radius': { min: 200, max: 4000, unit: 'm', desc: 'Radius of a disc uplift zone.' },
  'procedural.relief.peak': { min: 100, max: 900, unit: 'm', desc: 'Height of the highest land (the peak quantile is scaled to it).' },
  'procedural.relief.coast_taper': { min: 100, max: 3000, unit: 'm', desc: 'Distance over which uplift fades towards the sea: wider coastal plains.' },
  'procedural.relief.erosion.iterations': { integer: true, min: 0, max: 400, desc: 'Stream-power erosion passes. More passes cut deeper, more branching valleys.' },
  'procedural.relief.erosion.k': { min: 0, max: 0.2, desc: 'Erodibility: how fast flowing water cuts.' },
  'procedural.relief.hummocks.amplitude': { min: 0, max: 250, unit: 'm', desc: 'Height of the low hills on valley floors; flooding turns their tops into lake islands.' },
  'procedural.lake.target_km2': { min: 1, max: 15, unit: 'km²', desc: 'Area the reservoir floods behind the dam (Gatún).' },
  'procedural.lake.snap_radius': { min: 100, max: 3000, unit: 'm', desc: 'Search radius around the dam hint for the largest drainage.' },
  'procedural.lake.min_inland': { min: 0, max: 2000, unit: 'm', desc: 'The dam stays this far from the sea.' },
  'procedural.rivers.min_area_km2': { min: 0.1, max: 3, unit: 'km²', desc: 'Drainage area of the smallest drawn river: lower draws more rivers.' },
  'procedural.rivers.max_width': { min: 4, max: 60, unit: 'm', desc: 'Widest drawn river.' },
  'procedural.canal.width': { min: 40, max: 300, unit: 'm', desc: 'Canal width.' },
  'procedural.canal.depth': { min: 4, max: 30, unit: 'm', desc: 'Canal depth below its water level.' },
  'procedural.airport.radius': { min: 200, max: 2500, unit: 'm', desc: 'Search radius around the airport hint.' },
  'procedural.airport.runway_length': { min: 600, max: 2400, unit: 'm', desc: 'Runway length.' },
  'procedural.airport.runway_spacing': { min: 100, max: 600, unit: 'm', desc: 'Distance between the two parallel runways.' },
  'procedural.airport.grade_slope_max': { min: 0, max: 1, desc: 'Steepest earth embankment around the airfield (rise per run; 0.35 = about 1:3). The ground is cut into the hill on the high side and filled on the low side; the ramp lengthens with the height difference. 0 = the old fixed 150 m blend (cliffs).' },
  'procedural.airport.grade_reach_max': { min: 150, max: 1500, unit: 'm', desc: 'Farthest the airfield embankments reach from its edge; beyond it the natural ground is untouched.' },
  'procedural.airport.distance_weight': { min: 0, max: 1, desc: 'Penalty per metre of distance from the hint when scoring a site.' },
  'procedural.suitability.max_slope': { min: 0.05, max: 0.6, unit: 'm/m', desc: 'Slope at which a cell stops being buildable.' },
  'procedural.towns.road_discount': { min: 0.05, max: 1, desc: 'Growth step-cost multiplier near a main road; lower hugs roads more.' },
  'procedural.towns.separation': { min: 0, max: 1000, unit: 'm', desc: 'Unbuilt ground kept between different towns (0 = off).' },
  'procedural.towns.airport_buffer': { min: 0, max: 3000, unit: 'm', desc: 'No town builds within this distance of the airfield (0 = off).' },
  'procedural.towns.items[*].target_km2': { min: 0.01, max: 6, unit: 'km²', desc: 'Built area the town grows to.' },
  'procedural.towns.items[*].road_affinity': { min: 0, max: 10, desc: 'How strongly the town follows its road.' },
  'procedural.towns.items[*].seed_along.reach': { min: 50, max: 2000, unit: 'm', desc: 'A ribbon town builds only this close to its stretch of road.' },
  'procedural.towns.items[*].patches.wavelength': { min: 50, max: 1000, unit: 'm', desc: 'Size of the unbuilt gaps inside a patchy town.' },
  'procedural.towns.items[*].patches.threshold': { min: 0, max: 1, desc: 'Share of the area left unbuilt in gaps: higher is patchier.' },
  'procedural.districts.transit_weight': { min: 0, max: 1, desc: 'Density added around metro stations (districts only exist when at least one item is placed).' },
  'procedural.districts.transit_sigma': { min: 100, max: 2000, unit: 'm', desc: 'Reach of the station influence.' },
  'procedural.districts.coast_weight': { min: 0, max: 2, desc: 'Bayfront boost inside districts; never urbanises a bare coast.' },
  'procedural.districts.coast_sigma': { min: 100, max: 3000, unit: 'm', desc: 'Distance from the sea over which the coastal boost fades.' },
  'procedural.districts.access_floor': { min: 0, max: 1, desc: 'Share of density kept far from main roads (1 = roads do not matter).' },
  'procedural.districts.access_range': { min: 50, max: 2000, unit: 'm', desc: 'Distance from a main road at which access falls off.' },
  'procedural.districts.footprint': { min: 0.05, max: 0.9, desc: 'Density at which a district counts as present in its footprint area.' },
  'procedural.districts.airport_core_gap': { min: 0, max: 3000, unit: 'm', desc: 'Dense core (density >= 0.5) must stay this far from the airfield.' },
  'procedural.districts.items[*].sigma': { min: 50, max: 3000, unit: 'm', desc: 'Reach of this district influence.' },
  'procedural.districts.items[*].weight': { min: -1, max: 1, desc: 'Strength of this district; negative pushes density away.' },
  'procedural.landmarks.arch-bridge.route': { desc: 'Id of the road or railroad (procedural.roads.routes) whose crossing of the canal the arch bridge sits on. The bridge follows that crossing when the road or canal moves.' },
  'procedural.landmarks.arch-bridge.tolerance': { min: 5, max: 200, unit: 'm', desc: 'How far the arch bridge may sit from the generated crossing; the guard bridge-landmarks-on-crossing refuses an edit that moves it further.' },
  'procedural.trails[*].from': { desc: 'Where the trail starts. Only airport-terminal (the landside of the generated passenger terminal) is supported.' },
  'procedural.trails[*].to.highest_within': { min: 200, max: 3000, unit: 'm', desc: 'Viewpoint rule: the highest dry, unbuilt cell within this distance of the airfield (and inside the Act 1 rect). Never a coordinate.' },
  'procedural.trails[*].to.margin': { min: 0, max: 600, unit: 'm', desc: 'The viewpoint stays this far inside the Act 1 rect.' },
  'procedural.trails[*].to.min_distance': { min: 0, max: 3000, unit: 'm', desc: 'The viewpoint is at least this far (straight line) from the start.' },
  'procedural.trails[*].width': { min: 0.5, max: 4, unit: 'm', desc: 'Footpath width; a trail is not drivable.' },
  'procedural.trails[*].max_grade': { min: 0.05, max: 0.8, desc: 'Steepest edge of the trail (rise per run; 0.30 = about 1:3.3). Steeper than a road may be. Cells above it are refused; if no route exists the guard trail-connected-and-grade fires.' },
  'procedural.trails[*].min_length': { min: 100, max: 5000, unit: 'm', desc: 'Shortest routed trail length the guard accepts.' },
  'procedural.trails[*].max_length': { min: 100, max: 8000, unit: 'm', desc: 'Longest routed trail length; a viewpoint that needs more is skipped for the next highest candidate.' },
  'procedural.transit.lines[*].station_spacing': { min: 200, max: 3000, unit: 'm', desc: 'Target distance between stations along a line.' },
};

const norm = (path: string): string => path.replace(/\[\d+\]|\[id=[^\]]+\]/g, '[*]');
export const docFor = (path: string): ParamDoc | undefined => PARAM_DOCS[norm(path)];

/** Range problems for `value` at `path`; empty when fine or when the table has no entry. */
export function rangeProblems(path: string, value: Json): string[] {
  const d = docFor(path);
  if (!d) return [];
  if (typeof value === 'string' && d.min === undefined && d.max === undefined) return []; // a documented id, nothing to bound
  if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: expected a number${d.unit ? ` (${d.unit})` : ''}`];
  const out: string[] = [];
  if (d.integer && !Number.isInteger(value)) out.push(`${path}: expected an integer`);
  if (d.min !== undefined && value < d.min) out.push(`${path}: ${value} is below the minimum ${d.min}${d.unit ? ` ${d.unit}` : ''}`);
  if (d.max !== undefined && value > d.max) out.push(`${path}: ${value} is above the maximum ${d.max}${d.unit ? ` ${d.unit}` : ''}`);
  return out;
}

export interface ParamEntry {
  path: string;
  type: 'number' | 'string' | 'boolean' | 'point' | 'list' | 'null';
  default: Json;
  doc?: ParamDoc;
}

/** Every leaf of the default config as an addressable parameter (lists of entries with an `id` use `[id=…]`). */
export function listParams(proc: Json, base = 'procedural'): ParamEntry[] {
  const out: ParamEntry[] = [];
  const walk = (v: Json, path: string): void => {
    if (Array.isArray(v)) {
      const isPoint = v.length === 2 && v.every((x) => typeof x === 'number');
      if (isPoint || v.every((x) => typeof x === 'number' || typeof x === 'string' || Array.isArray(x))) {
        out.push({ path, type: isPoint ? 'point' : 'list', default: v, ...(docFor(path) ? { doc: docFor(path)! } : {}) });
        return;
      }
      v.forEach((e, i) => walk(e, `${path}${e && typeof e === 'object' && !Array.isArray(e) && typeof e.id === 'string' ? `[id=${e.id}]` : `[${i}]`}`));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, e] of Object.entries(v)) walk(e, `${path}.${k}`);
      return;
    }
    const type = v === null ? 'null' : (typeof v as 'number' | 'string' | 'boolean');
    out.push({ path, type, default: v, ...(docFor(path) ? { doc: docFor(path)! } : {}) });
  };
  walk(proc, base);
  return out;
}

/** JSON Schema of the config: structure from the default document, bounds from PARAM_DOCS. */
export function jsonSchema(proc: Json): Json {
  const build = (v: Json, path: string): Json => {
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === 'number')) return { type: 'array', items: { type: 'number' } };
      if (v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        // Entries of one list may differ in optional keys: take the union of their properties.
        const props: Record<string, Json> = {};
        for (const e of v as Record<string, Json>[]) for (const [k, x] of Object.entries(e)) props[k] ??= build(x, `${path}[*].${k}`);
        return { type: 'array', items: { type: 'object', properties: props } };
      }
      return { type: 'array' };
    }
    if (v && typeof v === 'object') return { type: 'object', properties: Object.fromEntries(Object.entries(v).map(([k, e]) => [k, build(e, `${path}.${k}`)])) };
    const d = PARAM_DOCS[path];
    const s: Record<string, Json> = { type: typeof v === 'number' ? (d?.integer ? 'integer' : 'number') : v === null ? 'null' : typeof v };
    if (d) {
      if (d.min !== undefined) s.minimum = d.min;
      if (d.max !== undefined) s.maximum = d.max;
      s.description = d.unit ? `${d.desc} [${d.unit}]` : d.desc;
    }
    return s;
  };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'TRÁNSITO procedural map config', ...(build(proc, 'procedural') as object) };
}
