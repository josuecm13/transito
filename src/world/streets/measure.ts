/**
 * Adapter: generated StreetNetwork + district → StreetMetricsInput → computeStreetMetrics
 * (src/world/street-metrics.ts, the single metric definition shared with the frozen references).
 *
 * - Edges: street edges (frames excluded) whose midpoint lies in the district. Generated streets
 *   never cross district borders; avenues are split at district borders by the frame, so each
 *   piece belongs to one district. Known artifact: where an avenue crosses a district border its
 *   joint node has degree 1 inside each district (a dead end in that district's metrics).
 * - Blocks: blocks whose interior point lies in the district.
 *     blocks: 'enclosed' (default) — a block touching any frame (coast, limit, district border,
 *       active-area border) counts as clipped. This mirrors the engine (ST_Polygonize over roads
 *       + the bbox ring; every face not closed by roads alone is is_clipped and excluded).
 *     blocks: 'unclipped' — only blocks touching the active-area border are clipped.
 *   Medians (Block.isMedian) are always excluded, as in the reference.
 * - Area: 'land' (default) — playable land of the district inside the active area (the sum of
 *   its faces, which tile that land exactly); 'cells' — the district's grid cells inside the
 *   active area including water, the analogue of the reference's bbox area (st_area(bbox), which
 *   includes sea and non-road land).
 * - excludeClasses (e.g. ['alley']): drops those street classes before measuring, as if they did
 *   not exist: their edges leave the node degrees and the street length, and blocks are recomputed
 *   as the faces of the graph without them (an alley that splits a block no longer does). Use it
 *   to compare an informal district against a reference whose source has no such streets: the
 *   engine does not import footway / path / steps, so La Carpio's frozen metrics contain no
 *   alleys, and the generator's alleys play that role. Recomputing faces needs a playable-land
 *   test: `isInside` (default: sliceWorld(spec).isPlayableLand).
 */
import type { WorldSpec } from '../spec.ts';
import { districtAt } from '../spec.ts';
import type { Rect } from '../geometry.ts';
import type { Vec2 } from '../vec.ts';
import { sliceWorld } from '../slice.ts';
import type { StreetMetrics, StreetMetricsInput } from '../street-metrics.ts';
import { computeStreetMetrics } from '../street-metrics.ts';
import type { StreetNetwork } from './generate.ts';
import type { Block } from './faces.ts';
import { buildBlocks } from './faces.ts';
import type { GraphSnapshot, StreetClass } from './planar-graph.ts';

export interface DistrictMeasureOptions {
  blocks?: 'enclosed' | 'unclipped';
  area?: 'land' | 'cells';
  /** Street classes measured as absent (edges dropped, blocks recomputed without them). */
  excludeClasses?: readonly StreetClass[];
  /** Playable-land test used when blocks are recomputed (default sliceWorld(spec).isPlayableLand). */
  isInside?: (p: Vec2) => boolean;
}

/**
 * The network without the given street classes: their edges are removed (edge ids renumbered,
 * nodes kept) and blocks are rebuilt as the faces of what is left.
 */
export function withoutClasses(
  net: StreetNetwork,
  spec: WorldSpec,
  classes: readonly StreetClass[],
  isInside: (p: Vec2) => boolean = sliceWorld(spec).isPlayableLand,
): StreetNetwork {
  if (classes.length === 0) return net;
  const drop = new Set<string>(classes);
  const edges = net.graph.edges.filter((e) => !drop.has(e.cls)).map((e, i) => ({ ...e, id: i }));
  const graph: GraphSnapshot = { nodes: net.graph.nodes, edges };
  const blocks: Block[] = buildBlocks(graph, { isInside, districtOf: (p) => districtAt(spec, p)?.id });
  return { ...net, graph, blocks };
}

export interface DistrictMetricsInput extends StreetMetricsInput {
  landKm2: number;
  cellsKm2: number;
}

export function districtMetricsInput(
  net: StreetNetwork,
  spec: WorldSpec,
  rect: Rect,
  districtId: string,
  opts: DistrictMeasureOptions = {},
): DistrictMetricsInput {
  if (opts.excludeClasses && opts.excludeClasses.length > 0) {
    net = withoutClasses(net, spec, opts.excludeClasses, opts.isInside);
  }
  const { nodes } = net.graph;
  const edges = net.graph.edges
    .filter((e) => {
      if (e.cls === 'frame') return false;
      const a = nodes[e.a] as { x: number; y: number };
      const b = nodes[e.b] as { x: number; y: number };
      return districtAt(spec, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })?.id === districtId;
    })
    .map((e) => ({ u: e.a, v: e.b, length: e.length }));
  const mine = net.blocks.filter((b) => b.district === districtId);
  const enclosed = (opts.blocks ?? 'enclosed') === 'enclosed';
  const blocks = mine.map((b) => ({ area: b.area, isMedian: b.isMedian, isClipped: enclosed ? b.frameKinds.length > 0 : b.isClipped }));
  const landKm2 = mine.reduce((s, b) => s + b.area, 0) / 1e6;
  const cellsKm2 = districtCellsKm2(spec, rect, districtId);
  return { edges, blocks, areaKm2: (opts.area ?? 'land') === 'land' ? landKm2 : cellsKm2, landKm2, cellsKm2 };
}

/** Area (km²) of the district's grid cells inside the rect. */
export function districtCellsKm2(spec: WorldSpec, rect: Rect, districtId: string): number {
  const cs = spec.bounds.cellSize;
  const rows = spec.grid.length;
  const code = spec.districts.find((d) => d.id === districtId)?.code;
  let m2 = 0;
  spec.grid.forEach((row, r) =>
    row.forEach((c, ci) => {
      if (c !== code) return;
      const w = Math.min((ci + 1) * cs, rect.maxX) - Math.max(ci * cs, rect.minX);
      const h = Math.min((rows - r) * cs, rect.maxY) - Math.max((rows - 1 - r) * cs, rect.minY);
      if (w > 0 && h > 0) m2 += w * h;
    }),
  );
  return m2 / 1e6;
}

export function measureDistrict(
  net: StreetNetwork,
  spec: WorldSpec,
  rect: Rect,
  districtId: string,
  opts: DistrictMeasureOptions = {},
): StreetMetrics {
  return computeStreetMetrics(districtMetricsInput(net, spec, rect, districtId, opts));
}

