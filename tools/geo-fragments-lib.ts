/**
 * Pure parts of tools/geo-fragments.mjs: fragment geometry, profile statistics and the
 * deterministic YAML writer. No I/O here, so every function is unit-tested (tests/geo-fragments.test.ts).
 * Street topology metrics are NOT redefined: they come from src/world/street-metrics.ts.
 */
import { computeStreetMetrics, dedupeEdges, mapDataToMetricsInput, percentileCont } from '../src/world/street-metrics.ts';
import type { MapDataLike } from '../src/world/street-metrics.ts';

export const MAX_SIDE_M = 1414; // a square of this side is ~2 km²
export const METERS_PER_DEG_LAT = 111195; // same constant the elevation analysis uses (R = 6371 km)
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export type Bbox = [number, number, number, number]; // [min_lon, min_lat, max_lon, max_lat]

const round7 = (v: number) => Math.round(v * 1e7) / 1e7;

/** Square of side `sizeM` centred on (lat, lon), rounded to 1e-7° (OSM precision). Same maths as reference-sectors. */
export function squareBbox(lat: number, lon: number, sizeM: number): Bbox {
  if (!(sizeM > 0)) throw new Error('size must be positive');
  if (sizeM > MAX_SIDE_M) throw new Error(`size ${sizeM} m is over ${MAX_SIDE_M} m (2 km² cap)`);
  const R = 6371008.8;
  const dLat = (sizeM / 2 / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [round7(lon - dLon), round7(lat - dLat), round7(lon + dLon), round7(lat + dLat)];
}

export const sameBbox = (a: readonly number[], b: readonly number[]) =>
  a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9);

/** Centre and approximate side (m) of a lon/lat box, for adopting an existing import. */
export function bboxCenterSize(b: Bbox): { lat: number; lon: number; width_m: number; height_m: number } {
  const lat = (b[1] + b[3]) / 2;
  return {
    lat: round7(lat),
    lon: round7((b[0] + b[2]) / 2),
    width_m: Math.round((b[2] - b[0]) * METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
    height_m: Math.round((b[3] - b[1]) * METERS_PER_DEG_LAT),
  };
}

const r = (v: number, d = 4) => {
  const k = 10 ** d;
  const x = Math.round(v * k) / k;
  return Object.is(x, -0) ? 0 : x;
};

// ---------------------------------------------------------------------------------------------
// Relief

export type ElevationGrid = {
  origin: { latitude: number; longitude: number };
  lat_step: number;
  lon_step: number;
  rows: number;
  cols: number;
  heights: number[]; // row-major from the south edge, west → east
};

const sortedAsc = (xs: number[]) => [...xs].sort((a, b) => a - b);

/**
 * Height and slope distribution of the grid. Slope per cell = hypot of the forward differences in
 * local metres, as a percentage (rise/run × 100). The game matches this DISTRIBUTION, never the
 * absolute heights.
 */
export function reliefStats(grid: ElevationGrid) {
  const { rows, cols, heights: h } = grid;
  if (rows < 2 || cols < 2 || h.length !== rows * cols) throw new Error('elevation grid: bad shape');
  const dy = grid.lat_step * METERS_PER_DEG_LAT;
  const dx = grid.lon_step * METERS_PER_DEG_LAT * Math.cos((grid.origin.latitude * Math.PI) / 180);
  const slopes: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const z = h[i * cols + j] as number;
      const gx = ((h[i * cols + j + 1] as number) - z) / dx;
      const gy = ((h[(i + 1) * cols + j] as number) - z) / dy;
      slopes.push(Math.hypot(gx, gy) * 100);
    }
  }
  const hs = sortedAsc(h);
  const ss = sortedAsc(slopes);
  const min = hs[0] as number;
  const max = hs[hs.length - 1] as number;
  return {
    grid_cells: `${cols}x${rows}`,
    cell_size_m: [r(dx, 1), r(dy, 1)] as [number, number],
    height_min_m: r(min, 1),
    height_p50_m: r(percentileCont(hs, 0.5), 1),
    height_max_m: r(max, 1),
    relief_m: r(max - min, 1),
    slope_p50_pct: r(percentileCont(ss, 0.5), 1),
    slope_p90_pct: r(percentileCont(ss, 0.9), 1),
    slope_p99_pct: r(percentileCont(ss, 0.99), 1),
  };
}

// ---------------------------------------------------------------------------------------------
// Road classes

export type SegmentLike = {
  from_node_id: string | number;
  to_node_id: string | number;
  distance_meters: number;
  source_lane_count?: number | null;
  street?: { classification?: string | null } | null;
};

/** Km and share per classification over the deduplicated undirected edges, plus lane-tag coverage. */
export function roadClassMix(segments: SegmentLike[]) {
  const seen = new Set<string>();
  const km = new Map<string, number>();
  let total = 0;
  let edges = 0;
  let tagged = 0;
  for (const s of segments) {
    const a = String(s.from_node_id);
    const b = String(s.to_node_id);
    const [u, v] = a <= b ? [a, b] : [b, a];
    const key = `${u}\u0000${v}\u0000${s.distance_meters}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = s.street?.classification || 'unclassified';
    km.set(cls, (km.get(cls) ?? 0) + s.distance_meters / 1000);
    total += s.distance_meters / 1000;
    edges++;
    if (s.source_lane_count != null) tagged++;
  }
  const classes = [...km.entries()]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .map(([name, k]) => ({ class: name, km: r(k, 3), share: total > 0 ? r(k / total, 4) : 0 }));
  return { total_km: r(total, 3), classes, lane_tag_coverage: edges ? r(tagged / edges, 4) : 0 };
}

// ---------------------------------------------------------------------------------------------
// Buildings

export type GeoJsonPolygon = { type: string; coordinates: unknown };

/** Area (m²) of a Polygon/MultiPolygon in local equirectangular metres around `lat0`. */
export function polygonAreaM2(geom: GeoJsonPolygon | null | undefined, lat0: number): number {
  if (!geom) return 0;
  const kx = METERS_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const ring = (pts: number[][]) => {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i] as number[];
      const [x2, y2] = pts[i + 1] as number[];
      s += (x1 as number) * (y2 as number) - (x2 as number) * (y1 as number);
    }
    return (s / 2) * kx * METERS_PER_DEG_LAT;
  };
  const poly = (rings: number[][][]) =>
    rings.reduce((acc, rg, i) => acc + (i === 0 ? Math.abs(ring(rg)) : -Math.abs(ring(rg))), 0);
  if (geom.type === 'Polygon') return poly(geom.coordinates as number[][][]);
  if (geom.type === 'MultiPolygon') return (geom.coordinates as number[][][][]).reduce((a, p) => a + poly(p), 0);
  return 0;
}

export type BuildingLike = {
  geometry?: GeoJsonPolygon | null;
  properties: { levels?: number | null; height_meters?: number | null; block_id?: string | null };
};

const quantiles = (xs: number[], d: number) => {
  const s = sortedAsc(xs);
  return { p10: r(percentileCont(s, 0.1), d), p50: r(percentileCont(s, 0.5), d), p90: r(percentileCont(s, 0.9), d) };
};

/** Below these, OSM mapping of buildings is too thin to read lot and footprint patterns from. */
export const SPARSE_BUILDINGS_PER_KM2 = 1000;
export const SPARSE_FOOTPRINT_COVER = 0.08;

export function buildingStats(buildings: BuildingLike[], fragmentKm2: number, lat0: number) {
  const areas = buildings.map((b) => polygonAreaM2(b.geometry, lat0)).filter((a) => a > 0);
  const levels = buildings.map((b) => b.properties.levels).filter((v): v is number => typeof v === 'number');
  const heights = buildings.map((b) => b.properties.height_meters).filter((v): v is number => typeof v === 'number');
  const n = buildings.length;
  const perKm2 = fragmentKm2 > 0 ? n / fragmentKm2 : 0;
  const cover = fragmentKm2 > 0 ? areas.reduce((a, b) => a + b, 0) / (fragmentKm2 * 1e6) : 0;
  const sparse = perKm2 < SPARSE_BUILDINGS_PER_KM2 || cover < SPARSE_FOOTPRINT_COVER;
  const facts = `${Math.round(perKm2)} buildings per km2, footprints cover ${r(cover * 100, 1)}% of the fragment`;
  return {
    count: n,
    per_km2: Math.round(perKm2),
    footprint_cover_of_fragment: r(cover, 4),
    footprint_area_m2: areas.length ? quantiles(areas, 1) : null,
    levels: { coverage: n ? r(levels.length / n, 4) : 0, ...(levels.length ? quantiles(levels, 1) : {}) },
    height_m: { coverage: n ? r(heights.length / n, 4) : 0, ...(heights.length ? quantiles(heights, 1) : {}) },
    data_quality: sparse
      ? `sparse: ${facts} (thresholds: < ${SPARSE_BUILDINGS_PER_KM2} per km2 or < ${SPARSE_FOOTPRINT_COVER * 100}% cover). ` +
        'OSM building gaps are common in Panama barrios; read lot, footprint and fill from a better-mapped analogue (see la-carpio) and say so.'
      : `ok: ${facts}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Fill (engine generation fingerprints)

export type FingerprintJson = {
  width: { median: number; iqr: number };
  depth: { median: number; iqr: number };
  front_setback: { median: number; iqr: number };
  side_gap: { median: number; iqr: number };
  coverage: number | null;
  median_levels: number | null;
  style: string;
};

const med = (xs: number[]) => percentileCont(sortedAsc(xs), 0.5);

/** Per settlement style: how many exemplar blocks, and the median of each fingerprint field. */
export function fillSummary(fps: FingerprintJson[]) {
  const styles = [...new Set(fps.map((f) => f.style))].sort();
  const per = (list: FingerprintJson[], pick: (f: FingerprintJson) => number | null) => {
    const v = list.map(pick).filter((x): x is number => typeof x === 'number');
    return v.length ? r(med(v), 2) : null;
  };
  return styles.map((style) => {
    const l = fps.filter((f) => f.style === style);
    return {
      style,
      exemplar_blocks: l.length,
      lot_width_m: per(l, (f) => f.width.median),
      lot_width_iqr_m: per(l, (f) => f.width.iqr),
      lot_depth_m: per(l, (f) => f.depth.median),
      lot_depth_iqr_m: per(l, (f) => f.depth.iqr),
      front_setback_m: per(l, (f) => f.front_setback.median),
      front_setback_iqr_m: per(l, (f) => f.front_setback.iqr),
      side_gap_m: per(l, (f) => f.side_gap.median),
      side_gap_iqr_m: per(l, (f) => f.side_gap.iqr),
      frontage_coverage: per(l, (f) => f.coverage),
      median_levels: per(l, (f) => f.median_levels),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Profile assembly

export type Fragment = {
  slug: string;
  import_area_id: string;
  bbox: Bbox;
  place_name: string;
};

export type ProfileInput = {
  fragment: Fragment;
  km2: number;
  mapData: MapDataLike & {
    road_segments: { features: { properties: SegmentLike }[] };
    blocks: { features: { properties: { area_square_meters: number; is_median?: boolean | null; is_clipped?: boolean | null } }[] };
    buildings: { features: BuildingLike[] };
    pois: { features: { properties: { category?: string | null } }[] };
    area_features?: { features: { properties: { kind?: string | null } }[] };
    elevation?: { source?: string; attribution?: string; grid?: ElevationGrid } | null;
    generation?: Record<string, unknown> | null;
    generated_buildings?: { features: unknown[] };
  };
  /** null = no generation run; undefined = fingerprints could not be read (engine DB unreachable). */
  fingerprints: FingerprintJson[] | null | undefined;
};

const countBy = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
};

/** Plain object (keys in insertion order) ready for `toYaml`. `extracted` is added by the caller. */
export function buildProfile(input: ProfileInput): Record<string, unknown> {
  const { fragment, km2, mapData } = input;
  const lat0 = (fragment.bbox[1] + fragment.bbox[3]) / 2;
  const streets = computeStreetMetrics(mapDataToMetricsInput(mapData, km2));
  const el = mapData.elevation;

  const streetsOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(streets)) streetsOut[k] = r(v, k.endsWith('_m2') ? 1 : 4);

  const gen = mapData.generation;
  let fill: Record<string, unknown>;
  if (!gen) {
    fill = { generation_run: false, note: 'no generation run; rerun `npm run geo -- profile <slug> --generate`' };
  } else {
    fill = {
      generation_run: true,
      algorithm_version: gen.algorithm_version ?? null,
      seed: gen.seed ?? null,
      generated_buildings: mapData.generated_buildings?.features.length ?? 0,
      eligible_blocks: gen.eligible_block_count ?? null,
      blocks_filled: gen.block_count ?? null,
      stale: gen.stale ?? null,
      styles:
        input.fingerprints === undefined
          ? 'unavailable: engine database not reachable (fingerprints are stored only in table block_fingerprints)'
          : (input.fingerprints ?? []).length === 0
            ? 'no exemplar blocks: the run used road-class defaults, not measured fingerprints'
            : fillSummary(input.fingerprints ?? []),
    };
  }

  return {
    fragment: fragment.slug,
    provenance: {
      import_area_id: fragment.import_area_id,
      place_name: fragment.place_name,
      bbox: fragment.bbox,
      km2: r(km2, 6),
      source: `geospatial-reconstruction-engine GET /import-areas/${fragment.import_area_id}/map-data?mode=filter`,
      attribution: [OSM_ATTRIBUTION, el?.attribution ?? 'no elevation grid'],
      elevation_source: el?.source ?? null,
    },
    streets: streetsOut,
    road_classes: roadClassMix(mapData.road_segments.features.map((f) => f.properties)),
    buildings: buildingStats(mapData.buildings.features, km2, lat0),
    fill,
    relief: el?.grid ? reliefStats(el.grid) : { note: 'no elevation grid in map-data' },
    pois: {
      count: mapData.pois.features.length,
      by_kind: countBy(mapData.pois.features.map((f) => f.properties.category || 'unknown')),
      area_features: countBy((mapData.area_features?.features ?? []).map((f) => f.properties.kind || 'unknown')),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Deterministic YAML

const PLAIN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const key = (k: string) => (PLAIN.test(k) ? k : JSON.stringify(k));

function scalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite number ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return String(v);
  return JSON.stringify(String(v));
}

/** Block-style YAML of plain objects/arrays; arrays of scalars are inline; JSON-quoted strings; key order kept. */
export function toYaml(value: Record<string, unknown>, indent = 0): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== 'object')) lines.push(`${pad}${key(k)}: [${v.map(scalar).join(', ')}]`);
      else if (v.length === 0) lines.push(`${pad}${key(k)}: []`);
      else {
        lines.push(`${pad}${key(k)}:`);
        for (const item of v) {
          const body = toYaml(item as Record<string, unknown>, indent + 4).split('\n');
          lines.push(`${pad}  - ${(body[0] as string).slice(indent + 4)}`, ...body.slice(1));
        }
      }
    } else if (v && typeof v === 'object') {
      if (Object.keys(v).length === 0) lines.push(`${pad}${key(k)}: {}`);
      else lines.push(`${pad}${key(k)}:`, toYaml(v as Record<string, unknown>, indent + 2));
    } else lines.push(`${pad}${key(k)}: ${scalar(v)}`);
  }
  return lines.join('\n');
}

export const EXTRACTED_RE = /^extracted: .*$/m;

/**
 * Final file text. The extraction date is kept from `previous` when the data is otherwise
 * identical, so a rerun with no change is byte-identical.
 */
export function renderProfile(profile: Record<string, unknown>, today: string, previous?: string): string {
  const header = `# TRÁNSITO fragment profile — generated by tools/geo-fragments.mjs, do not edit by hand.\n# Inspiration only: the game never imports this geometry; numbers feed spec decisions.\n`;
  const body = toYaml(profile) + '\n';
  const withDate = (d: string) => `${header}extracted: ${JSON.stringify(d)}\n${body}`;
  if (previous !== undefined) {
    const m = /^extracted: "(\d{4}-\d{2}-\d{2})"$/m.exec(previous);
    if (m && previous.replace(EXTRACTED_RE, '') === withDate('x').replace(EXTRACTED_RE, '')) return previous;
  }
  return withDate(today);
}
