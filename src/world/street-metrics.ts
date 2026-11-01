/**
 * Street-network realism metrics: one definition shared by the frozen references
 * (`specs/map/street-metrics.yaml`, produced from real OSM data) and the realism tests of the
 * generated network.
 *
 * Definition (mirrors the reference SQL in issue #7, Evidence):
 * - Edges: undirected, deduplicated by `(min(u,v), max(u,v), length)`. The engine stores both
 *   directions of every segment; both collapse into one edge. Two distinct segments between the
 *   same pair of nodes with different lengths stay as two edges (parallel edges), exactly like the
 *   SQL `select distinct least, greatest, distance_meters`.
 * - Node degree: number of deduplicated edge endpoints at the node (a self-loop counts 2, as in
 *   the SQL `union all` of u and v).
 * - Nodes of degree 2 are excluded: they are joints inside one street and depend on how OSM
 *   splits ways. The remaining nodes are the "intersections" (dead ends included).
 *   `dead_end_share` = share of degree 1, `t_share` = degree 3, `x_share` = degree >= 4,
 *   all over the non-degree-2 nodes.
 * - `intersections_per_km2` = count of non-degree-2 nodes / `areaKm2`.
 * - `street_km_per_km2` = sum of deduplicated edge lengths (km) / `areaKm2`.
 * - `mean_segment_m` = mean deduplicated edge length.
 * - Blocks: excluding `isMedian` and `isClipped`; `block_area_*` are `percentile_cont` (linear
 *   interpolation between closest ranks) at 0.1 / 0.5 / 0.9.
 *
 * Differences vs the SQL:
 * - Node ids are compared as given; numbers and strings with the same text are the same node.
 * - The SQL scopes edges to an import area by joining `navigable_nodes` on `from_node_id`. Here
 *   the caller decides the scope: pass the edges of one area (the engine's `map-data` in its
 *   default `mode=filter` returns whole segments of the area, which matches the SQL scope;
 *   `mode=clip` cuts segments at the bbox and shifts network metrics by a few percent).
 * - Empty inputs give 0 instead of SQL NULL.
 */

export type NodeId = string | number;

export type StreetMetricsInput = {
  edges: { u: NodeId; v: NodeId; length: number }[];
  blocks: { area: number; isMedian?: boolean; isClipped?: boolean }[];
  areaKm2: number;
};

export type StreetMetrics = {
  blocks_measured: number;
  block_area_p10_m2: number;
  block_area_median_m2: number;
  block_area_p90_m2: number;
  dead_end_share: number;
  t_share: number;
  x_share: number;
  intersections_per_km2: number;
  street_km_per_km2: number;
  mean_segment_m: number;
};

/** Postgres `percentile_cont`: linear interpolation between closest ranks. `sorted` ascending. */
export function percentileCont(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = p * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

/** Undirected edges deduplicated by (min id, max id, length), like the reference SQL. */
export function dedupeEdges(
  edges: StreetMetricsInput['edges'],
): { u: string; v: string; length: number }[] {
  const seen = new Set<string>();
  const out: { u: string; v: string; length: number }[] = [];
  for (const e of edges) {
    const a = String(e.u);
    const b = String(e.v);
    const [u, v] = a <= b ? [a, b] : [b, a];
    const key = `${u}\u0000${v}\u0000${e.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ u, v, length: e.length });
  }
  return out;
}

export function computeStreetMetrics(input: StreetMetricsInput): StreetMetrics {
  const areas = input.blocks
    .filter((b) => !b.isMedian && !b.isClipped)
    .map((b) => b.area)
    .sort((a, b) => a - b);

  const edges = dedupeEdges(input.edges);
  const degree = new Map<string, number>();
  let totalLength = 0;
  for (const e of edges) {
    degree.set(e.u, (degree.get(e.u) ?? 0) + 1);
    degree.set(e.v, (degree.get(e.v) ?? 0) + 1);
    totalLength += e.length;
  }

  let inter = 0;
  let dead = 0;
  let t3 = 0;
  let x4 = 0;
  for (const deg of degree.values()) {
    if (deg === 2) continue;
    inter++;
    if (deg === 1) dead++;
    else if (deg === 3) t3++;
    else if (deg >= 4) x4++;
  }

  const km2 = input.areaKm2;
  return {
    blocks_measured: areas.length,
    block_area_p10_m2: percentileCont(areas, 0.1),
    block_area_median_m2: percentileCont(areas, 0.5),
    block_area_p90_m2: percentileCont(areas, 0.9),
    dead_end_share: inter ? dead / inter : 0,
    t_share: inter ? t3 / inter : 0,
    x_share: inter ? x4 / inter : 0,
    intersections_per_km2: km2 > 0 ? inter / km2 : 0,
    street_km_per_km2: km2 > 0 ? totalLength / 1000 / km2 : 0,
    mean_segment_m: edges.length ? totalLength / edges.length : 0,
  };
}

/** Structural shape of the engine's `GET /import-areas/{id}/map-data` (only what the metric reads). */
export type MapDataLike = {
  road_segments: {
    features: { properties: { from_node_id: NodeId; to_node_id: NodeId; distance_meters: number } }[];
  };
  blocks: {
    features: {
      properties: { area_square_meters: number; is_median?: boolean | null; is_clipped?: boolean | null };
    }[];
  };
};

export function mapDataToMetricsInput(mapData: MapDataLike, areaKm2: number): StreetMetricsInput {
  return {
    edges: mapData.road_segments.features.map(({ properties: p }) => ({
      u: p.from_node_id,
      v: p.to_node_id,
      length: p.distance_meters,
    })),
    blocks: mapData.blocks.features.map(({ properties: p }) => ({
      area: p.area_square_meters,
      isMedian: p.is_median === true,
      isClipped: p.is_clipped === true,
    })),
    areaKm2,
  };
}
