/**
 * Street network generator (issue #7, S3): avenues (fixed) → frame → formal districts
 * (tensor-field streamlines) → informal districts (organic growth, informal.ts, S4) → cleanup →
 * blocks.
 *
 * Pure and deterministic: same spec + seed → deep-equal output. Every random draw comes from a
 * fork of `createRng(seed)` labelled by district and pass, so districts and passes never shift
 * each other's randomness.
 *
 * Formal district passes (README "Streets", style formal):
 *   1. collector, major eigenvector, separation spacing.collector — runs through everything (X).
 *   2. collector, minor eigenvector, separation spacing.collector — the superblock grid.
 *   3. local, major eigenvector, separation spacing.local — runs through (X with collectors).
 *   4. local, minor eigenvector, separation spacing.local × minorSpacingRatio — "strip" mode:
 *      each one spans the strip between two consecutive crossing streets and stops there (T);
 *      at each crossing it continues with probability `throughProbability` (X). Strips are
 *      seeded independently, so cross streets are staggered like real brick-pattern blocks. With
 *      probability `deadEndProbability` one stops short of the next street (cul-de-sac).
 * A street end that stops in the open snaps forward to the street ahead (T) when one is close;
 * an end at the coast / district border / playable limit gets a frame connector so the block
 * there closes; an end at the active-area border lands on it.
 */
import type { StreetProfile, StreetStyleDistrict, WorldSpec } from '../spec.ts';
import { districtAt } from '../spec.ts';
import type { WorldSlice } from '../slice.ts';
import type { Vec2 } from '../vec.ts';
import type { Rng } from '../rng.ts';
import { createRng } from '../rng.ts';
import { clipPolylineToRect } from '../geometry.ts';
import type { EdgeProps, GraphEdge, GraphSnapshot, StreetClass, Tolerances } from './planar-graph.ts';
import { CLASS_RANK, PlanarGraph, projectOnSegment, segmentIntersection } from './planar-graph.ts';
import type { Block } from './faces.ts';
import { buildBlocks } from './faces.ts';
import type { Basis, TensorField } from './tensor-field.ts';
import { alignSegments, createTensorField, sampleTensorField } from './tensor-field.ts';
import type { Family } from './streamlines.ts';
import { arcLengths, enforceVertexGap, SampleIndex, simplify, slicePolyline, traceStreamline } from './streamlines.ts';
import type { DistrictRegion, FrameSegment } from './region.ts';
import { AVENUE_KINDS, buildFrame, buildFrameIndex, createDistrictRegion } from './region.ts';
import { growOrganicDistrict } from './informal.ts';

/** Generator constants that are not spec data (the tuning knobs that ARE data live in world.yaml). */
export interface GeneratorParams {
  /** Streamline integration step (m). */
  step: number;
  /** Tensor field sampling cell (m). */
  fieldCell: number;
  /** Weight / decay (m) of the avenue-aligned basis added around every avenue. */
  avenueWeight: number;
  avenueDecay: number;
  /** Tracing stops when a parallel street is within dtestRatio × separation. */
  dtestRatio: number;
  /** A seed is rejected when a parallel street is within seedRatio × separation. */
  seedRatio: number;
  /** Streets within this angle (deg) count as parallel for separation. */
  parallelAngle: number;
  /** Largest turn of a streamline in one step (deg). */
  maxTurn: number;
  /** Shortest streamline kept (m). */
  minStreamline: number;
  /** Douglas–Peucker tolerance (m) and minimum vertex gap (m) of traced polylines. */
  simplifyTolerance: number;
  minVertexGap: number;
  /** Extra clearance (m) beyond half width + sidewalk from coast / borders / barriers. */
  edgeClearance: number;
  /** A free end snaps to a street ahead within dtest + snapAhead (m). */
  snapAhead: number;
  /** Dead-end chains shorter than this (m) are pruned. */
  danglingMin: number;
  /** A dead end within penetrationReach + this (m) of another street is closed onto it (T). */
  deadEndMargin: number;
  /** ...or within this distance (m) of one of its nodes: it ends on that node. */
  deadEndJunctionSnap: number;
  /** A walk island is linked to the walkable network within this distance (m). */
  islandLinkReach: number;
  /** Least angle (deg) between an island link and the streets it leaves / joins. */
  islandLinkMinAngle: number;
  /** Minor local separation = spacing.local × this. */
  minorSpacingRatio: number;
  /** Chance that a strip-mode local continues through a crossing street. */
  throughProbability: number;
  /** Chance that a strip-mode local stops short of the next street (cul-de-sac). */
  deadEndProbability: number;
  /** Extra gap (m) a cul-de-sac end keeps beyond the street ahead's carriageway + sidewalk. */
  culDeSacClearance: number;
  /** Seed jitter along the street, as a fraction of the separation. */
  seedJitter: number;
  // Organic growth (informal districts, informal.ts). The spec knobs live in growth.*.
  /** Largest turn (deg) of a continuing informal street at each segment. */
  informalTurn: number;
  /** Branch / seed heading = 90° ± this (deg). */
  informalBranchTurn: number;
  /** Largest bend (deg) allowed when an end snaps to a node / street within snap_radius. */
  informalSnapTurn: number;
  /** A new informal street may not run within this distance (m) of a near-parallel street. */
  informalSeparation: number;
  /** Streets within this angle (deg) count as parallel for informalSeparation. */
  informalParallelAngle: number;
  /** Queue delay of a branch (in segments) relative to the street it hangs from. */
  informalBranchDelay: number;
  /**
   * A new informal junction may not form within this distance (m) of another junction: the end
   * moves onto that junction when it can, else the proposal is dropped.
   */
  informalJunctionGap: number;
  /** Chance that an informal street continues past a street it crosses (X junction). */
  informalCrossThrough: number;
  /** Chance that a free informal street end stops there (dead end) instead of continuing. */
  informalStopProbability: number;
  /** Chance that a local branch is a spur: 1..informalSpurSegments segments, may dead-end. */
  informalSpurProbability: number;
  informalSpurSegments: number;
  /** Spur segment length = segment_length × this. */
  informalSpurLengthRatio: number;
  /** Coverage: allowed points farther than this (m) from every street get a proposal. */
  informalCoverageGap: number;
  informalCoveragePasses: number;
  /** Infill: a face of the grown network larger than this (m²) gets a cross street (0 = off). */
  informalInfillArea: number;
  informalInfillPasses: number;
  /** Hard cap on proposals per informal district (runtime bound). */
  informalMaxProposals: number;
  /** Alley segment length = segment_length × this; alleys grow 1..alleyMaxSegments segments. */
  alleyLengthRatio: number;
  alleyMaxSegments: number;
  /** Shortest alley segment (m). */
  alleyMinSegment: number;
  /** Alley separation = informalSeparation × this. */
  alleySeparationRatio: number;
}

export const DEFAULT_PARAMS: GeneratorParams = {
  step: 5,
  fieldCell: 10,
  avenueWeight: 2,
  avenueDecay: 60,
  dtestRatio: 0.5,
  seedRatio: 0.9,
  parallelAngle: 30,
  maxTurn: 30,
  minStreamline: 30,
  simplifyTolerance: 0.5,
  minVertexGap: 10,
  edgeClearance: 2,
  snapAhead: 15,
  danglingMin: 25,
  deadEndMargin: 1,
  deadEndJunctionSnap: 3,
  islandLinkReach: 80,
  islandLinkMinAngle: 30,
  minorSpacingRatio: 1.5,
  throughProbability: 0.03,
  deadEndProbability: 0.15,
  culDeSacClearance: 3,
  seedJitter: 0.35,
  informalTurn: 12,
  informalBranchTurn: 12,
  informalSnapTurn: 40,
  informalSeparation: 40,
  informalParallelAngle: 35,
  informalBranchDelay: 3,
  informalJunctionGap: 20,
  informalCrossThrough: 0.1,
  informalStopProbability: 0.35,
  informalSpurProbability: 0.6,
  informalSpurSegments: 2,
  informalSpurLengthRatio: 0.5,
  informalCoverageGap: 55,
  informalCoveragePasses: 3,
  informalInfillArea: 16000,
  informalInfillPasses: 3,
  informalMaxProposals: 40000,
  alleyLengthRatio: 0.5,
  alleyMaxSegments: 3,
  alleyMinSegment: 8,
  alleySeparationRatio: 0.5,
};

export interface StreetNetwork {
  seed: number;
  /** Streets (avenue / collector / local / alley) and frame edges (cls 'frame'). */
  graph: GraphSnapshot;
  /** Bounded faces with playable interior. */
  blocks: Block[];
  stats: {
    connectors: number;
    prunedDangling: number;
    /** Dead ends inside a neighbouring street closed onto it (closeTouchingDeadEnds). */
    closedDeadEnds: number;
    /** Walk islands linked to the walkable network (linkWalkIslands). */
    linkedIslands: number;
    removedFloating: number;
    shortEdgesLeft: number;
  };
}

export type InformalStyle = Extract<StreetStyleDistrict, { style: 'informal' }>;
export type FormalStyle = Extract<StreetStyleDistrict, { style: 'formal' }>;

/** Everything a district generator needs; shared by the formal passes and the S4 grower. */
export interface DistrictContext {
  spec: WorldSpec;
  slice: WorldSlice;
  graph: PlanarGraph;
  region: DistrictRegion;
  rng: Rng;
  params: GeneratorParams;
  /** Edge props for a generated class in this district (hierarchy widths). */
  propsFor(cls: Exclude<StreetClass, 'avenue'>): EdgeProps;
  /** Clearance (m) a street of this class keeps from coast / borders / barriers. */
  marginFor(cls: Exclude<StreetClass, 'avenue'>): number;
  /** May a street of this class pass through p? (district, playable land, clearance) */
  allowed(cls: Exclude<StreetClass, 'avenue'>, p: Vec2): boolean;
  /**
   * Links a street dead end to the frame within reach (coast / limit / district; area border
   * when the node is on it) so the block there closes. Returns whether a connector was added.
   */
  connectToFrame(node: number, cls: Exclude<StreetClass, 'avenue'>): boolean;
}

export interface InformalContext extends DistrictContext {
  style: InformalStyle;
}

/** S4 extension point: organic growth for `style: informal` districts. */
export type InformalGrower = (ctx: InformalContext) => void;

/** Default informal grower: organic growth (informal.ts, S4). */
export const growInformalDistrict: InformalGrower = (ctx) => growOrganicDistrict(ctx);

export interface GenerateOptions {
  /** Overrides street_styles.seed. */
  seed?: number;
  informal?: InformalGrower;
  tolerances?: Partial<Tolerances>;
  params?: Partial<GeneratorParams>;
  /** Filled with phase timings (ms) when given. Not part of the (deterministic) result. */
  profile?: Record<string, number>;
}

const now = (): number => globalThis.performance?.now() ?? Date.now();

export function avenueProps(spec: WorldSpec, routeId: string, kind: string, width?: number): EdgeProps {
  const p = spec.streetProfiles[kind] as StreetProfile | undefined;
  return { cls: 'avenue', width: width ?? p?.width ?? 0, sidewalk: p?.sidewalk ?? 0, fixed: true, routeId };
}

export function generateStreets(spec: WorldSpec, slice: WorldSlice, options: GenerateOptions = {}): StreetNetwork {
  const params: GeneratorParams = { ...DEFAULT_PARAMS, ...options.params };
  const seed = options.seed ?? spec.streetStyles.seed;
  const prof = options.profile;
  let t0 = now();
  const mark = (name: string) => {
    if (!prof) return;
    const t = now();
    prof[name] = (prof[name] ?? 0) + (t - t0);
    t0 = t;
  };

  const graph = new PlanarGraph(options.tolerances);
  const rect = slice.rect;

  // 1. Avenues: fixed, clipped to the active area.
  for (const route of spec.routes) {
    if (!AVENUE_KINDS.has(route.kind)) continue;
    for (const piece of clipPolylineToRect(route.points, rect)) graph.addPolyline(piece, avenueProps(spec, route.id, route.kind, route.width));
  }
  // 2. Frame.
  const frame: FrameSegment[] = buildFrame(spec, rect);
  for (const f of frame) graph.addSegment(f.a, f.b, { cls: 'frame', width: 0, sidewalk: 0, fixed: false, frame: f.kind });
  const frameIndex = buildFrameIndex(frame, spec, rect);
  mark('avenues+frame');

  const root = createRng(seed);
  let connectors = 0;
  const districtIds = Object.keys(spec.streetStyles.districts).sort();
  // 3. Formal districts first, then informal ones (so organic growth can join formal streets).
  for (const phase of ['formal', 'informal'] as const) {
    for (const id of districtIds) {
      const style = spec.streetStyles.districts[id] as StreetStyleDistrict;
      if (style.style !== phase) continue;
      const region = createDistrictRegion(spec, slice, id, frameIndex);
      if (!region) continue; // no cells inside the active area
      const ctx = makeContext(spec, slice, graph, region, root.fork(`streets:${id}`), params, () => connectors++);
      if (style.style === 'formal') generateFormal(ctx, style);
      else (options.informal ?? growInformalDistrict)({ ...ctx, style });
      mark(`district:${id}`);
    }
  }

  // 4. Cleanup.
  graph.repair();
  graph.collapseShortEdges();
  const prunedDangling = graph.pruneDangling(params.danglingMin);
  const streetOk = streetPlacementCheck(spec, slice);
  let closedDeadEnds = closeTouchingDeadEnds(graph, streetOk, params);
  const linkedIslands = linkWalkIslands(graph, streetOk, params);
  const removedFloating = graph.removeFloatingStreets();
  graph.repair();
  graph.collapseShortEdges();
  // Collapsing can leave a new end inside a street: close those too, then re-collapse.
  const late = closeTouchingDeadEnds(graph, streetOk, params);
  closedDeadEnds += late;
  if (late > 0) graph.repair();
  const shortEdgesLeft = graph.collapseShortEdges();
  mark('cleanup');

  // 5. Blocks.
  const snap = graph.snapshot();
  const blocks = buildBlocks(snap, { isInside: slice.isPlayableLand, districtOf: (p) => districtAt(spec, p)?.id });
  mark('faces');
  return { seed, graph: snap, blocks, stats: { connectors, prunedDangling, closedDeadEnds, linkedIslands, removedFloating, shortEdgesLeft } };
}

// ------------------------------------------------------------------ dead ends and walk islands

/** May a straight piece a→b of a street of this class / district lie there? (samples every 4 m, ends included) */
export type StreetPlacementCheck = (props: EdgeProps, a: Vec2, b: Vec2) => boolean;

/** Generated streets stay on playable land inside their own district; avenues are never placed here. */
export function streetPlacementCheck(spec: WorldSpec, slice: WorldSlice): StreetPlacementCheck {
  return (props, a, b) => {
    if (props.fixed || props.district === undefined) return false;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      if (!slice.isPlayableLand(p) || districtAt(spec, p)?.id !== props.district) return false;
    }
    return true;
  };
}

/**
 * Reach (m) within which a dead end of street `stub` counts as inside street `other`: the stub's
 * carriageway (half width) touches the other street's carriageway + sidewalk.
 */
export function penetrationReach(stub: EdgeProps, other: EdgeProps): number {
  return other.width / 2 + other.sidewalk + stub.width / 2;
}

const edgeProps = (e: GraphEdge): EdgeProps => {
  const { a: _a, b: _b, id: _id, ...p } = e;
  return p;
};

/**
 * Translates street edge e (both its nodes) so its line passes exactly through P, keeping it
 * straight: the T on a pinned avenue end then has no kink in the other street. Only when both
 * nodes are free, every moved street edge stays placeable (`ok`) and at least its class minimum
 * long, and no moved edge would cross another. Returns whether it moved.
 */
function shiftEdgeOnto(graph: PlanarGraph, e: GraphEdge, P: Vec2, ok: StreetPlacementCheck): boolean {
  const A = graph.node(e.a);
  const B = graph.node(e.b);
  const pr = projectOnSegment(P, A, B);
  if (pr.t <= 0 || pr.t >= 1) return false;
  const o = { x: P.x - pr.x, y: P.y - pr.y };
  const moving = new Set([e.a, e.b]);
  for (const n of moving) {
    if (graph.node(n).pinned || graph.incident(n).some((id) => graph.edge(id).fixed)) return false;
  }
  const at = (n: number): Vec2 => {
    const q = graph.node(n);
    return moving.has(n) ? { x: q.x + o.x, y: q.y + o.y } : { x: q.x, y: q.y };
  };
  const touched = new Set<number>();
  for (const n of moving) for (const id of graph.incident(n)) touched.add(id);
  for (const id of touched) {
    const f = graph.edge(id);
    const p = at(f.a);
    const q = at(f.b);
    if (f.cls !== 'frame' && (Math.hypot(q.x - p.x, q.y - p.y) < graph.minLengthOf(f.cls) || !ok(edgeProps(f), p, q))) return false;
    const hit = firstHit(graph, p, q, (g) => !touched.has(g.id) && g.a !== f.a && g.a !== f.b && g.b !== f.a && g.b !== f.b);
    if (hit) return false;
  }
  for (const n of moving) {
    const target = at(n);
    if (!graph.shiftNode(n, target)) return false;
  }
  return true;
}

/**
 * An avenue that ends in a T on a narrower street: its carriageway (rounded at the junction, as
 * rendered) would reach across that street's far sidewalk. The cross street's pieces next to the
 * junction take the avenue's carriageway and sidewalk (class avenue, not fixed, no route id, the
 * street's district), for avenue width/2 + sidewalk + street width/2 + 1 m on each side (the whole
 * edge when the rest would be shorter than the class minimum): a T-bar as wide as the avenue.
 */
function widenTeeBar(graph: PlanarGraph, v: number, avenue: GraphEdge): void {
  const isStreet = (e: GraphEdge) => e.cls !== 'frame';
  for (const id of [...graph.incident(v)]) {
    if (!graph.hasEdge(id)) continue;
    const h = graph.edge(id);
    if (!isStreet(h) || h.fixed || h.id === avenue.id) continue;
    if (h.width / 2 + h.sidewalk / 2 >= avenue.width / 2) continue; // its corner clears the avenue
    const reach = avenue.width / 2 + avenue.sidewalk + h.width / 2 + 1;
    const len = graph.length(h);
    let piece = h;
    if (len - reach >= graph.minLengthOf(h.cls)) {
      const far = graph.node(graph.other(h, v));
      const near = graph.node(v);
      const t = reach / len;
      const m = graph.splitEdge(h.id, { x: near.x + (far.x - near.x) * t, y: near.y + (far.y - near.y) * t });
      const e = graph.edgeBetween(v, m);
      if (!e) continue;
      piece = e;
    }
    piece.cls = avenue.cls;
    piece.width = avenue.width;
    piece.sidewalk = avenue.sidewalk;
  }
}

/**
 * Closes street dead ends that stop inside a neighbouring street (end within
 * `penetrationReach` + deadEndMargin of its centreline, or within deadEndJunctionSnap of one of its
 * nodes) without a junction there, so the network has a real T / X instead of an overlap:
 *   - a free end (non-fixed stub) is extended along its own direction onto the other street's
 *     centreline (projection when that line misses it) and ends there in a T, or on the other
 *     street's node when that lands within deadEndJunctionSnap of it. The stub's last edge is
 *     re-inserted from its inner node, so no short edge is left at the end.
 *   - a fixed end (an avenue that ends inside the active area, pinned) never moves: the other
 *     (generated) street is brought onto it instead — translated sideways, straight, when that is
 *     clean (`shiftEdgeOnto`), else bent through it — a few meters at most; next to the junction
 *     it takes the avenue's width (`widenTeeBar`).
 * Each change is checked with `ok` (district, playable land); ends that cannot be closed that way
 * are left alone. Edges sharing a node with the stub (its own continuation) are not targets.
 * Deterministic: dead ends in node id order. Returns the number of dead ends closed.
 */
export function closeTouchingDeadEnds(graph: PlanarGraph, ok: StreetPlacementCheck, params: GeneratorParams): number {
  const isStreet = (e: GraphEdge) => e.cls !== 'frame';
  const margin = params.deadEndMargin;
  const jsnap = params.deadEndJunctionSnap;
  let closed = 0;
  for (const node of graph.nodes()) {
    const v = node.id;
    if (!graph.hasNode(v) || graph.degree(v, isStreet) !== 1) continue;
    const stub = graph.edge(graph.incident(v).find((id) => isStreet(graph.edge(id))) as number);
    const keep = graph.other(stub, v);
    const P = graph.node(v);
    const K = graph.node(keep);
    // Nearest street the end lies inside (smallest distance to its centreline).
    let best: { e: GraphEdge; d: number } | undefined;
    const r = 40;
    for (const id of graph.edgesInBox(P.x - r, P.y - r, P.x + r, P.y + r)) {
      const e = graph.edge(id);
      if (!isStreet(e) || e.id === stub.id || e.a === v || e.b === v || e.a === keep || e.b === keep) continue;
      const A = graph.node(e.a);
      const B = graph.node(e.b);
      const pr = projectOnSegment(P, A, B);
      const d = Math.sqrt(pr.d2);
      const nodeD = Math.min(Math.hypot(A.x - P.x, A.y - P.y), Math.hypot(B.x - P.x, B.y - P.y));
      if ((d < penetrationReach(stub, e) + margin || nodeD <= jsnap) && (!best || d < best.d)) best = { e, d };
    }
    if (!best) continue;
    const e = best.e;
    const A = graph.node(e.a);
    const B = graph.node(e.b);
    if (stub.fixed) {
      // The avenue end stays: bring the other street onto it.
      if (e.fixed) continue;
      if (shiftEdgeOnto(graph, e, P, ok)) {
        const moved = graph.edgeBetween(e.a, e.b);
        if (moved) graph.routeEdgeThrough(moved.id, v);
      } else {
        if (!ok(edgeProps(e), A, P) || !ok(edgeProps(e), P, B)) continue;
        graph.routeEdgeThrough(e.id, v);
      }
      widenTeeBar(graph, v, stub);
      closed++;
      continue;
    }
    // Target: the stub's own line onto the other street's centreline, else the closest point.
    const sl = Math.hypot(P.x - K.x, P.y - K.y);
    const dx = (P.x - K.x) / sl;
    const dy = (P.y - K.y) / sl;
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const reach = penetrationReach(stub, e) + margin;
    const den = dx * aby - dy * abx;
    let t = -1;
    if (Math.abs(den) > 1e-9) {
      const along = ((A.x - P.x) * aby - (A.y - P.y) * abx) / den;
      const u = ((A.x - P.x) * dy - (A.y - P.y) * dx) / den;
      if (u >= 0 && u <= 1 && along >= -reach && along <= 2 * reach) t = u;
    }
    if (t < 0) t = Math.max(0, Math.min(1, projectOnSegment(P, A, B).t));
    let q: Vec2 = { x: A.x + abx * t, y: A.y + aby * t };
    if (Math.hypot(q.x - A.x, q.y - A.y) <= jsnap) q = { x: A.x, y: A.y };
    else if (Math.hypot(q.x - B.x, q.y - B.y) <= jsnap) q = { x: B.x, y: B.y };
    if (Math.hypot(q.x - K.x, q.y - K.y) <= graph.tol.snap) continue;
    const sp = edgeProps(stub);
    if (!ok(sp, K, q)) continue;
    graph.removeEdge(stub.id);
    graph.removeNodeIfIsolated(v);
    const target = graph.addNode(q);
    if (graph.hasNode(keep) && target !== keep) graph.connect(keep, target, sp);
    closed++;
  }
  return closed;
}

/**
 * Walk islands: generated streets whose walkable component (streets with sidewalk, and alleys)
 * holds no walkable avenue, i.e. that reach the rest of the network only through a street without
 * sidewalk (the highway). Informal growth seeds along every street of its district, the highway
 * included, so a few stubs hang from it: drivable in theory, but a pedestrian there can never
 * leave. Each island is linked by one straight street (the class of the island street it leaves,
 * locals before alleys) from the island node nearest to the walkable network to the nearest point
 * of it within islandLinkReach: a dead end heads on (no more than 90° off its street), any other
 * node and the joined street keep islandLinkMinAngle; never across a fixed street; checked with
 * `ok`.
 * Islands that cannot be linked stay as they are. Returns the number of islands linked.
 */
export function linkWalkIslands(graph: PlanarGraph, ok: StreetPlacementCheck, params: GeneratorParams): number {
  const isStreet = (e: GraphEdge) => e.cls !== 'frame';
  const walkable = (e: GraphEdge) => isStreet(e) && (e.sidewalk > 0 || e.cls === 'alley');
  const reach = params.islandLinkReach;
  const cosMin = Math.cos((params.islandLinkMinAngle * Math.PI) / 180);
  let linked = 0;
  for (let round = 0; round < 16; round++) {
    // Walkable components (union-find over node ids), anchored = holds a fixed walkable edge.
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
      parent.set(x, r);
      return r;
    };
    const edges = graph.edges().filter(walkable);
    for (const e of edges) {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    const anchored = new Set<number>();
    for (const e of edges) if (e.fixed) anchored.add(find(e.a));
    // Street components over every street (the highway included): only islands hanging from an
    // avenue are linked; streets reaching no avenue at all are removeFloatingStreets' business.
    const sparent = new Map<number, number>();
    const sfind = (x: number): number => {
      let r = x;
      while ((sparent.get(r) ?? r) !== r) r = sparent.get(r) as number;
      sparent.set(x, r);
      return r;
    };
    const streets = graph.edges().filter(isStreet);
    for (const e of streets) {
      const ra = sfind(e.a);
      const rb = sfind(e.b);
      if (ra !== rb) sparent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    const onAvenue = new Set<number>();
    for (const e of streets) if (e.fixed) onAvenue.add(sfind(e.a));
    const islands = new Map<number, number[]>();
    for (const n of graph.nodes()) {
      const inc = graph.incident(n.id).map((id) => graph.edge(id));
      if (inc.some((e) => e.fixed) || !inc.some(walkable)) continue;
      const root = find(n.id);
      if (anchored.has(root) || !onAvenue.has(sfind(n.id))) continue;
      const list = islands.get(root);
      if (list) list.push(n.id);
      else islands.set(root, [n.id]);
    }
    if (islands.size === 0) break;
    let changed = false;
    for (const [root, members] of [...islands].sort((p, q) => p[0] - q[0])) {
      let best: { v: number; q: Vec2; d: number; props: EdgeProps } | undefined;
      for (const v of members) {
        const P = graph.node(v);
        const arms = graph.incident(v).map((id) => graph.edge(id)).filter(isStreet);
        const own = arms.filter(walkable).sort((p, q) => CLASS_RANK[q.cls] - CLASS_RANK[p.cls] || p.id - q.id)[0] as GraphEdge;
        const dirs = arms.map((e) => {
          const o = graph.node(graph.other(e, v));
          const l = Math.hypot(o.x - P.x, o.y - P.y);
          return { x: (o.x - P.x) / l, y: (o.y - P.y) / l };
        });
        for (const id of graph.edgesInBox(P.x - reach, P.y - reach, P.x + reach, P.y + reach)) {
          const e = graph.edge(id);
          if (!walkable(e) || find(e.a) === root || !anchored.has(find(e.a))) continue;
          const A = graph.node(e.a);
          const B = graph.node(e.b);
          const pr = projectOnSegment(P, A, B);
          const d = Math.sqrt(pr.d2);
          if (d > reach || d < graph.tol.minLength || (best && d >= best.d)) continue;
          const q = { x: pr.x, y: pr.y };
          const u = { x: (q.x - P.x) / d, y: (q.y - P.y) / d };
          // A dead end heads on (never back along its street); elsewhere keep min_angle to every arm.
          if (arms.length === 1 ? u.x * (dirs[0] as Vec2).x + u.y * (dirs[0] as Vec2).y > 0 : dirs.some((w) => u.x * w.x + u.y * w.y > cosMin)) continue;
          const el = Math.hypot(B.x - A.x, B.y - A.y);
          if (Math.abs((u.x * (B.x - A.x) + u.y * (B.y - A.y)) / el) > cosMin) continue;
          const props = edgeProps(own);
          if (!ok(props, P, q)) continue;
          if (firstHit(graph, P, q, (f) => f.fixed && f.a !== v && f.b !== v)) continue;
          best = { v, q, d, props };
        }
      }
      if (!best) continue;
      const target = graph.addNode(best.q);
      graph.connect(best.v, target, best.props);
      linked++;
      changed = true;
      break; // components changed: recompute
    }
    if (!changed) break;
  }
  return linked;
}

function makeContext(
  spec: WorldSpec,
  slice: WorldSlice,
  graph: PlanarGraph,
  region: DistrictRegion,
  rng: Rng,
  params: GeneratorParams,
  onConnector: () => void,
): DistrictContext {
  const hier = spec.streetStyles.hierarchy;
  const marginFor = (cls: Exclude<StreetClass, 'avenue'>) => hier[cls].width / 2 + hier[cls].sidewalk + params.edgeClearance;
  const isStreet = (e: GraphEdge) => e.cls !== 'frame';
  return {
    spec,
    slice,
    graph,
    region,
    rng,
    params,
    propsFor: (cls) => ({ cls, width: hier[cls].width, sidewalk: hier[cls].sidewalk, fixed: false, district: region.id }),
    marginFor,
    allowed: (cls, p) => {
      if (!region.contains(p)) return false;
      const m = marginFor(cls);
      return region.clearance(p, m + 1) >= m;
    },
    connectToFrame: (node, cls) => {
      if (!graph.hasNode(node) || graph.degree(node, isStreet) !== 1) return false;
      if (graph.incident(node).some((id) => graph.edge(id).cls === 'frame')) return false;
      const n = graph.node(node);
      const p = { x: n.x, y: n.y };
      const near = region.nearestFrame(p, marginFor(cls) + 6);
      if (!near || near.dist <= graph.tol.snap) return false;
      // Never cross a street with a connector.
      const hit = firstHit(graph, p, near.point, (e) => isStreet(e) && e.a !== node && e.b !== node);
      if (hit) return false;
      graph.addSegment(p, near.point, { cls: 'frame', width: 0, sidewalk: 0, fixed: false, frame: 'connector' });
      onConnector();
      return true;
    },
  };
}

/** First proper crossing of segment a→b with an edge accepted by pred (smallest t). */
export function firstHit(
  graph: PlanarGraph,
  a: Vec2,
  b: Vec2,
  pred: (e: GraphEdge) => boolean,
): { t: number; point: Vec2; edge: GraphEdge } | undefined {
  let best: { t: number; point: Vec2; edge: GraphEdge } | undefined;
  for (const id of graph.edgesInBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
    const e = graph.edge(id);
    if (!pred(e)) continue;
    const hit = segmentIntersection(a, b, graph.node(e.a), graph.node(e.b));
    if (hit && (!best || hit.t < best.t)) best = { t: hit.t, point: { x: a.x + (b.x - a.x) * hit.t, y: a.y + (b.y - a.y) * hit.t }, edge: e };
  }
  return best;
}

// ------------------------------------------------------------------ formal districts

export function buildDistrictField(ctx: DistrictContext, style: FormalStyle): TensorField {
  const { spec, slice, region, params } = ctx;
  const box = region.box;
  const pad = 30;
  const near = (a: Vec2, b: Vec2, reach: number) =>
    Math.max(a.x, b.x) >= box.minX - reach &&
    Math.min(a.x, b.x) <= box.maxX + reach &&
    Math.max(a.y, b.y) >= box.minY - reach &&
    Math.min(a.y, b.y) <= box.maxY + reach;
  const { width: W, height: H } = spec.bounds;
  const coast: [Vec2, Vec2][] = [];
  for (const ring of [spec.land, ...spec.islands.map((i) => i.points)]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Vec2;
      const b = ring[(i + 1) % ring.length] as Vec2;
      const onEdge = (a.x === 0 && b.x === 0) || (a.x === W && b.x === W) || (a.y === 0 && b.y === 0) || (a.y === H && b.y === H);
      if (!onEdge) coast.push([a, b]);
    }
  }
  const elements: Basis[] = [];
  const background: Basis[] = [];
  for (const el of style.field) {
    const weight = el.weight ?? 1;
    if (el.kind === 'grid') background.push({ kind: 'grid', theta: (el.angle * Math.PI) / 180, weight });
    else if (el.kind === 'radial') background.push({ kind: 'radial', center: el.at, weight, ...(el.decay !== undefined ? { decay: el.decay } : {}) });
  }
  elements.push(...background);
  const bgField = background.length > 0 ? createTensorField(background) : undefined;
  for (const el of style.field) {
    if (el.kind !== 'coastline') continue;
    const reach = el.decay !== undefined ? el.decay * 3 : Infinity;
    const segments = coast.filter(([a, b]) => near(a, b, reach));
    if (segments.length === 0) continue;
    elements.push({
      kind: 'polyline',
      segments,
      weight: el.weight ?? 1,
      flips: alignSegments(segments, bgField),
      ...(el.decay !== undefined ? { decay: el.decay } : {}),
    });
  }
  const styleField = elements.length > 0 ? createTensorField([...elements]) : undefined;
  const avenueSegs: [Vec2, Vec2][] = [];
  for (const route of spec.routes) {
    if (!AVENUE_KINDS.has(route.kind)) continue;
    for (const piece of clipPolylineToRect(route.points, slice.rect)) {
      for (let i = 0; i < piece.length - 1; i++) {
        const a = piece[i] as Vec2;
        const b = piece[i + 1] as Vec2;
        if (near(a, b, params.avenueDecay * 3)) avenueSegs.push([a, b]);
      }
    }
  }
  if (avenueSegs.length > 0) {
    elements.push({ kind: 'polyline', segments: avenueSegs, weight: params.avenueWeight, decay: params.avenueDecay, flips: alignSegments(avenueSegs, styleField) });
  }
  return sampleTensorField(
    createTensorField(elements),
    { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad },
    params.fieldCell,
  );
}

interface Pass {
  name: string;
  cls: 'collector' | 'local';
  family: Family;
  dsep: number;
  mode: 'through' | 'strip';
  /** Strip mode: seed offset beside crossing streets (half the strip width). */
  stripOffset: number;
}

export function generateFormal(ctx: DistrictContext, style: FormalStyle): void {
  const field = buildDistrictField(ctx, style);
  const { graph, region, params } = ctx;
  const samples = new SampleIndex(32);
  const box = region.box;
  // Existing streets in reach (avenues) take part in separation.
  for (const id of graph.edgesInBox(box.minX - 100, box.minY - 100, box.maxX + 100, box.maxY + 100)) {
    const e = graph.edge(id);
    if (e.cls === 'frame') continue;
    const a = graph.node(e.a);
    const b = graph.node(e.b);
    samples.addPolyline([a, b], params.step);
  }
  const sc = style.spacing.collector;
  const sl = style.spacing.local;
  const passes: Pass[] = [
    { name: 'collector-major', cls: 'collector', family: 'major', dsep: sc, mode: 'through', stripOffset: 0 },
    { name: 'collector-minor', cls: 'collector', family: 'minor', dsep: sc, mode: 'through', stripOffset: 0 },
    { name: 'local-major', cls: 'local', family: 'major', dsep: sl, mode: 'through', stripOffset: 0 },
    { name: 'local-minor', cls: 'local', family: 'minor', dsep: sl * params.minorSpacingRatio, mode: 'strip', stripOffset: sl / 2 },
  ];
  for (const pass of passes) runPass(ctx, field, samples, pass, Math.max(sc, sl));
}

function runPass(ctx: DistrictContext, field: TensorField, samples: SampleIndex, pass: Pass, stripReach: number): void {
  const { graph, region, params } = ctx;
  const rng = ctx.rng.fork(pass.name);
  const cosPar = Math.cos((params.parallelAngle * Math.PI) / 180);
  const dtest = pass.dsep * params.dtestRatio;
  const allowed = (p: Vec2) => ctx.allowed(pass.cls, p);
  const traceOpts = {
    step: params.step,
    maxLength: pass.mode === 'strip' ? 3 * stripReach : 6000,
    dtest,
    cosParallel: cosPar,
    maxTurn: (params.maxTurn * Math.PI) / 180,
    allowed,
    samples,
    // Strip mode: a parallel street on the other side of a crossing street does not count.
    ...(pass.mode === 'strip' ? { visible: (from: Vec2, to: Vec2) => !firstHit(graph, from, to, (e) => e.cls !== 'frame') } : {}),
  };
  const props = ctx.propsFor(pass.cls);
  const isStreet = (e: GraphEdge) => e.cls !== 'frame';
  const box = region.box;

  const queue: Vec2[] = [];
  /** Seeds at ±offset beside a polyline, every `pass.dsep` (at least one, mid-piece), jittered. */
  const offsetSeeds = (pts: readonly Vec2[], offset: number) => {
    const s = arcLengths(pts);
    const total = s[s.length - 1] as number;
    if (total === 0) return;
    const stepAlong = pass.dsep;
    const first = total < stepAlong ? total / 2 : stepAlong * rng.range(0.2, 0.8);
    const jitter = Math.min(params.seedJitter * pass.dsep, total / 2);
    for (let d = first; d < total; d += stepAlong) {
      const along = Math.max(0, Math.min(total, d + rng.range(-1, 1) * jitter));
      let i = 1;
      while (i < pts.length - 1 && (s[i] as number) < along) i++;
      const a = pts[i - 1] as Vec2;
      const b = pts[i] as Vec2;
      const seg = (s[i] as number) - (s[i - 1] as number);
      if (seg === 0) continue;
      const t = (along - (s[i - 1] as number)) / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const nx = -(b.y - a.y) / seg;
      const ny = (b.x - a.x) / seg;
      queue.push({ x: p.x + nx * offset, y: p.y + ny * offset }, { x: p.x - nx * offset, y: p.y - ny * offset });
    }
  };
  const cosPar45 = Math.SQRT1_2;
  // Initial seeds beside every street already in the district (avenues, earlier passes). In strip
  // mode, streets crossing the pass direction seed mid-strip (half the strip width beside them).
  for (const id of graph.edgesInBox(box.minX, box.minY, box.maxX, box.maxY)) {
    const e = graph.edge(id);
    if (!isStreet(e)) continue;
    if (e.district !== undefined && e.district !== region.id) continue;
    const a = graph.node(e.a);
    const b = graph.node(e.b);
    let offset = pass.dsep;
    if (pass.mode === 'strip') {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const d = field.direction({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, pass.family);
      if (d && len > 0 && Math.abs(((b.x - a.x) * d.x + (b.y - a.y) * d.y) / len) < cosPar45) offset = pass.stripOffset;
    }
    offsetSeeds([a, b], offset);
  }

  const tryStreamline = (seed: Vec2): boolean => {
    if (!allowed(seed)) return false;
    const dir = field.direction(seed, pass.family);
    if (!dir) return false;
    const vis = traceOpts.visible;
    if (samples.hasParallel(seed, dir, pass.dsep * params.seedRatio, cosPar, vis && ((q) => vis(seed, q)))) return false;
    const tr = traceStreamline(field, seed, pass.family, traceOpts);
    if (!tr || tr.points.length < 2) return false;
    let pts = tr.points;
    let [startEnd, endEnd] = tr.ends as [string, string];
    if (pass.mode === 'strip') {
      const cut = stripCut(graph, pts, tr.seedIndex, cosPar, params, props, rng);
      if (!cut) return false;
      pts = cut.pts;
      if (cut.cutStart) startEnd = 'cut';
      if (cut.cutEnd) endEnd = 'cut';
    }
    const total = arcLengths(pts)[pts.length - 1] as number;
    if (total < params.minStreamline) return false;
    pts = enforceVertexGap(simplify(pts, params.simplifyTolerance), params.minVertexGap);
    pts = finishEnd(ctx, pass, pts, endEnd, dtest);
    pts = finishEnd(ctx, pass, [...pts].reverse(), startEnd, dtest).reverse();
    const path = graph.addPolyline(pts, props);
    if (path.length < 2) return false;
    for (const [n, reason] of [[path[0] as number, startEnd], [path[path.length - 1] as number, endEnd]] as const) {
      if (reason === 'boundary') ctx.connectToFrame(n, pass.cls);
    }
    samples.addPolyline(pts, params.step);
    offsetSeeds(pts, pass.dsep);
    return true;
  };

  for (let scan = 0; scan < 4; scan++) {
    while (queue.length > 0) tryStreamline(queue.shift() as Vec2);
    // Coverage scan: seed whatever the offsets did not reach (jittered grid, fixed order).
    let added = 0;
    const g = pass.dsep;
    for (let y = box.minY + g * rng.range(0.25, 0.75); y < box.maxY; y += g) {
      for (let x = box.minX + g * rng.range(0.25, 0.75); x < box.maxX; x += g) {
        if (tryStreamline({ x, y })) added++;
        while (queue.length > 0) if (tryStreamline(queue.shift() as Vec2)) added++;
      }
    }
    if (added === 0) break;
  }
}

/**
 * Strip mode: keep the part of the streamline around the seed up to the first crossing street on
 * each side (continuing through a crossing with probability `throughProbability`). A cul-de-sac
 * stops short of the street ahead, but never within its carriageway + sidewalk: its end keeps
 * penetrationReach + deadEndMargin + culDeSacClearance from the crossing (else no cul-de-sac).
 */
function stripCut(
  graph: PlanarGraph,
  pts: Vec2[],
  seedIndex: number,
  cosPar: number,
  params: GeneratorParams,
  own: EdgeProps,
  rng: Rng,
): { pts: Vec2[]; cutStart: boolean; cutEnd: boolean } | undefined {
  const through = params.throughProbability;
  const deadEnd = params.deadEndProbability;
  const s = arcLengths(pts);
  /** Arc length of each crossing and the gap a cul-de-sac must keep from it. */
  const crossings: { at: number; gap: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as Vec2;
    const b = pts[i + 1] as Vec2;
    const seg = (s[i + 1] as number) - (s[i] as number);
    if (seg === 0) continue;
    for (const id of graph.edgesInBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
      const e = graph.edge(id);
      if (e.cls === 'frame') continue;
      const c = graph.node(e.a);
      const d = graph.node(e.b);
      const hit = segmentIntersection(a, b, c, d);
      if (!hit) continue;
      const el = Math.hypot(d.x - c.x, d.y - c.y);
      const cos = Math.abs(((b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y)) / (seg * el));
      if (cos >= cosPar) continue;
      crossings.push({ at: (s[i] as number) + hit.t * seg, gap: penetrationReach(own, e) + params.deadEndMargin + params.culDeSacClearance });
    }
  }
  crossings.sort((p, q) => p.at - q.at);
  const s0 = s[seedIndex] as number;
  const total = s[s.length - 1] as number;
  let end = total;
  let endGap = 0;
  let cutEnd = false;
  for (const c of crossings) {
    if (c.at <= s0) continue;
    if (rng.next() < through) continue;
    end = c.at;
    endGap = c.gap;
    cutEnd = true;
    break;
  }
  let start = 0;
  let cutStart = false;
  for (let i = crossings.length - 1; i >= 0; i--) {
    const c = (crossings[i] as (typeof crossings)[number]).at;
    if (c >= s0) continue;
    if (rng.next() < through) continue;
    start = c;
    cutStart = true;
    break;
  }
  // Cul-de-sac: stop 55–80% of the way to the street ahead (always drawn: fixed draw order).
  const deadRoll = rng.next();
  const deadAt = rng.range(0.55, 0.8);
  if (cutEnd && cutStart && deadRoll < deadEnd) {
    const stop = Math.min(s0 + (end - s0) * deadAt, end - endGap);
    if (stop - start >= params.minStreamline) end = stop;
  }
  if (end - start <= 0) return undefined;
  return { pts: slicePolyline(pts, start, end), cutStart, cutEnd };
}

/**
 * Handles the last point of `pts` by its end reason: open ends snap forward to a street ahead
 * (or to a street within reach) so they form a T instead of floating; ends at the active-area
 * border are projected exactly onto it.
 */
function finishEnd(ctx: DistrictContext, pass: Pass, pts: Vec2[], reason: string, dtest: number): Vec2[] {
  const { graph, slice, params } = ctx;
  if (pts.length < 2) return pts;
  const end = pts[pts.length - 1] as Vec2;
  const prev = pts[pts.length - 2] as Vec2;
  const isStreet = (e: GraphEdge) => e.cls !== 'frame';
  if (reason === 'boundary') {
    const r = slice.rect;
    const dx = Math.min(end.x - r.minX, r.maxX - end.x);
    const dy = Math.min(end.y - r.minY, r.maxY - end.y);
    if (Math.min(dx, dy) < 2) {
      const p = dx <= dy
        ? { x: end.x - r.minX < r.maxX - end.x ? r.minX : r.maxX, y: end.y }
        : { x: end.x, y: end.y - r.minY < r.maxY - end.y ? r.minY : r.maxY };
      return [...pts.slice(0, -1), p];
    }
    return pts;
  }
  if (reason === 'cut') return pts;
  const len = Math.hypot(end.x - prev.x, end.y - prev.y);
  if (len === 0) return pts;
  const dir = { x: (end.x - prev.x) / len, y: (end.y - prev.y) / len };
  const reach = dtest + params.snapAhead;
  const ahead = { x: end.x + dir.x * reach, y: end.y + dir.y * reach };
  const hit = firstHit(graph, end, ahead, isStreet);
  if (hit && segmentAllowed(ctx, pass.cls, end, hit.point)) return [...pts, hit.point];
  const near = graph.nearestEdge(end, params.snapAhead, isStreet);
  if (near) {
    const p = { x: near.x, y: near.y };
    const v = { x: p.x - end.x, y: p.y - end.y };
    const vl = Math.hypot(v.x, v.y);
    if (vl > 0 && (v.x * dir.x + v.y * dir.y) / vl > 0.5 && segmentAllowed(ctx, pass.cls, end, p)) return [...pts, p];
  }
  return pts;
}

function segmentAllowed(ctx: DistrictContext, cls: 'collector' | 'local', a: Vec2, b: Vec2): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / 4));
  for (let i = 1; i < n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    if (!ctx.region.contains(p)) return false;
  }
  return true;
}
