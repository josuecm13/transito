/**
 * Mutable planar street graph with explicit tolerances (issue #7, S3).
 *
 * Every edge is a straight segment; a curved street is a chain of edges through degree-2 nodes.
 * The graph stays planar under insertion: `addSegment` / `addPolyline` / `connect` split both
 * edges at every crossing and insert a node there, so two edges only ever meet at a shared node.
 *
 * Invariants kept by every mutation (tolerance `snap`, default 1 m):
 *   I1. No two nodes closer than `snap`.
 *   I2. No node closer than `snap` to the interior of an edge it is not an endpoint of.
 *   I3. No two edges cross except at a shared node.
 * Consequences: a new endpoint within `snap` of a node reuses it; within `snap` of an edge it
 * splits that edge (T junction); colinear / near-parallel overlaps (within `snap`) collapse into
 * the same chain of nodes, and duplicate edges between the same two nodes are merged.
 *
 * Minimum street length (`minLength`, 8 m; `minLengthAlley` for alleys): a crossing closer than
 * that to an endpoint of the crossed street is rerouted through that endpoint (the NEW street bends
 * by a few meters instead of leaving a stub on the old one). Fixed edges (avenues) are never
 * rerouted: they are inserted first and only ever split at points exactly on their segments.
 * Anything left short is fixed afterwards by `collapseShortEdges`.
 *
 * Frame edges (`cls: 'frame'`) are not streets: coastline, playable limit, active-area border,
 * district borders and short connectors from a street end to them. They close the faces (blocks)
 * along the edge of the street network and have no minimum length.
 *
 * Determinism: ids are allocated sequentially and every query returns ids in ascending order, so
 * the same sequence of calls always builds the same graph.
 */
import type { Vec2 } from '../vec.ts';

export type StreetClass = 'avenue' | 'collector' | 'local' | 'alley';
/**
 * coast = geometry.land / islands shoreline; limit = playable_boundary line; area = active-area
 * rectangle; district = border between two districts (grid cells); connector = short link from a
 * street's dead end to one of the others, so the faces close.
 */
export type FrameKind = 'coast' | 'limit' | 'area' | 'district' | 'connector';
export type EdgeClass = StreetClass | 'frame';

export const CLASS_RANK: Record<EdgeClass, number> = { frame: 0, alley: 1, local: 2, collector: 3, avenue: 4 };

export const isStreetClass = (c: EdgeClass): c is StreetClass => c !== 'frame';

export interface EdgeProps {
  cls: EdgeClass;
  /** Carriageway width (m); 0 for frame edges. */
  width: number;
  /** Sidewalk width on each side (m). */
  sidewalk: number;
  /** Fixed constraint (avenues from the spec): never moved, never rerouted. */
  fixed: boolean;
  /** District that generated the edge (generated streets only). */
  district?: string;
  /** Spec route id (avenues only). */
  routeId?: string;
  /** Set on frame edges, and on a street that runs exactly along a frame line. */
  frame?: FrameKind;
}

export interface GraphNode {
  readonly id: number;
  x: number;
  y: number;
  /** A spec vertex of a fixed route (or its clip point): never moved or merged away. */
  pinned: boolean;
}

export interface GraphEdge extends EdgeProps {
  readonly id: number;
  a: number;
  b: number;
}

export interface Tolerances {
  /** Node merge / point-on-edge distance (m). */
  snap: number;
  /** Minimum street edge length (m) except alleys. */
  minLength: number;
  /** Minimum alley edge length (m). */
  minLengthAlley: number;
  /** Spatial index cell size (m). */
  cell: number;
}

export const DEFAULT_TOLERANCES: Tolerances = { snap: 1, minLength: 8, minLengthAlley: 3, cell: 48 };

/** Compact, immutable copy of a graph: ids are 0..n-1 in creation order. */
export interface GraphSnapshot {
  nodes: { id: number; x: number; y: number; pinned: boolean }[];
  edges: (EdgeProps & { id: number; a: number; b: number; length: number })[];
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Uniform grid index from integer ids to boxes. Queries return ids ascending. */
class GridIndex {
  private readonly size: number;
  private readonly cells = new Map<number, Set<number>>();
  private readonly boxes = new Map<number, Box>();

  constructor(size: number) {
    this.size = size;
  }

  private range(b: Box): [number, number, number, number] {
    const s = this.size;
    return [Math.floor(b.minX / s), Math.floor(b.minY / s), Math.floor(b.maxX / s), Math.floor(b.maxY / s)];
  }

  private static key(ix: number, iy: number): number {
    return (ix + 0x8000) * 0x10000 + (iy + 0x8000);
  }

  insert(id: number, b: Box): void {
    this.boxes.set(id, b);
    const [x0, y0, x1, y1] = this.range(b);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = GridIndex.key(ix, iy);
        let set = this.cells.get(k);
        if (!set) {
          set = new Set();
          this.cells.set(k, set);
        }
        set.add(id);
      }
    }
  }

  remove(id: number): void {
    const b = this.boxes.get(id);
    if (!b) return;
    this.boxes.delete(id);
    const [x0, y0, x1, y1] = this.range(b);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) this.cells.get(GridIndex.key(ix, iy))?.delete(id);
    }
  }

  query(b: Box): number[] {
    const out = new Set<number>();
    const [x0, y0, x1, y1] = this.range(b);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const set = this.cells.get(GridIndex.key(ix, iy));
        if (!set) continue;
        for (const id of set) {
          const o = this.boxes.get(id) as Box;
          if (o.maxX >= b.minX && o.minX <= b.maxX && o.maxY >= b.minY && o.minY <= b.maxY) out.add(id);
        }
      }
    }
    return [...out].sort((p, q) => p - q);
  }
}

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Parameter t of the projection of p on segment ab (unclamped) and the squared distance to it (clamped). */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; d2: number; x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const x = a.x + dx * tc;
  const y = a.y + dy * tc;
  return { t, d2: (p.x - x) ** 2 + (p.y - y) ** 2, x, y };
}

/**
 * Proper intersection of segments ab and cd: parameters t (on ab) and u (on cd) strictly inside
 * (0, 1), or undefined (parallel, colinear, touching at an endpoint, or disjoint).
 */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number } | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = cross(rx, ry, sx, sy);
  const scaleLen = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  if (scaleLen === 0 || Math.abs(den) <= 1e-12 * scaleLen) return undefined;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = cross(qx, qy, sx, sy) / den;
  const u = cross(qx, qy, rx, ry) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return undefined;
  return { t, u };
}

function mergeProps(e: GraphEdge, p: EdgeProps): void {
  if (isStreetClass(p.cls) && CLASS_RANK[p.cls] > CLASS_RANK[e.cls]) {
    // A street over an existing frame line keeps the frame kind (the face is still clipped there).
    const frame = e.frame ?? p.frame;
    e.cls = p.cls;
    e.width = p.width;
    e.sidewalk = p.sidewalk;
    e.district = p.district;
    e.routeId = p.routeId;
    if (frame !== undefined) e.frame = frame;
    else delete e.frame;
  } else if (!isStreetClass(p.cls) && e.frame === undefined && p.frame !== undefined) {
    e.frame = p.frame;
  }
  e.fixed = e.fixed || p.fixed;
}

const MAX_CONNECT_DEPTH = 64;

export class PlanarGraph {
  readonly tol: Tolerances;
  private readonly ns: (GraphNode | undefined)[] = [];
  private readonly es: (GraphEdge | undefined)[] = [];
  private readonly adj: number[][] = [];
  private readonly nodeIndex: GridIndex;
  private readonly edgeIndex: GridIndex;

  constructor(tol: Partial<Tolerances> = {}) {
    this.tol = { ...DEFAULT_TOLERANCES, ...tol };
    this.nodeIndex = new GridIndex(this.tol.cell);
    this.edgeIndex = new GridIndex(this.tol.cell);
  }

  // ---------------------------------------------------------------- read

  node(id: number): GraphNode {
    const n = this.ns[id];
    if (!n) throw new Error(`no node ${id}`);
    return n;
  }

  edge(id: number): GraphEdge {
    const e = this.es[id];
    if (!e) throw new Error(`no edge ${id}`);
    return e;
  }

  hasNode(id: number): boolean {
    return this.ns[id] !== undefined;
  }

  hasEdge(id: number): boolean {
    return this.es[id] !== undefined;
  }

  /** Live nodes in id order. */
  nodes(): GraphNode[] {
    return this.ns.filter((n): n is GraphNode => n !== undefined);
  }

  /** Live edges in id order. */
  edges(): GraphEdge[] {
    return this.es.filter((e): e is GraphEdge => e !== undefined);
  }

  /** Edge ids incident to a node (ascending). */
  incident(n: number): readonly number[] {
    return this.adj[n] ?? [];
  }

  degree(n: number, pred: (e: GraphEdge) => boolean = () => true): number {
    let d = 0;
    for (const id of this.incident(n)) if (pred(this.edge(id))) d++;
    return d;
  }

  other(e: GraphEdge, n: number): number {
    return e.a === n ? e.b : e.a;
  }

  edgeBetween(a: number, b: number): GraphEdge | undefined {
    for (const id of this.incident(a)) {
      const e = this.edge(id);
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
    }
    return undefined;
  }

  length(e: GraphEdge): number {
    const a = this.node(e.a);
    const b = this.node(e.b);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  minLengthOf(cls: EdgeClass): number {
    if (cls === 'frame') return 0;
    return cls === 'alley' ? this.tol.minLengthAlley : this.tol.minLength;
  }

  /** Node ids within r of p (exact distance), ascending. */
  nodesNear(p: Vec2, r: number): number[] {
    return this.nodeIndex
      .query({ minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r })
      .filter((id) => {
        const n = this.node(id);
        return (n.x - p.x) ** 2 + (n.y - p.y) ** 2 <= r * r;
      });
  }

  /** Edge ids whose bounding box overlaps the box, ascending. */
  edgesInBox(minX: number, minY: number, maxX: number, maxY: number): number[] {
    return this.edgeIndex.query({ minX, minY, maxX, maxY });
  }

  /** Nearest point on any edge accepted by `pred` within r of p. */
  nearestEdge(
    p: Vec2,
    r: number,
    pred: (e: GraphEdge) => boolean = () => true,
  ): { edge: number; x: number; y: number; t: number; dist: number } | undefined {
    let best: { edge: number; x: number; y: number; t: number; dist: number } | undefined;
    for (const id of this.edgesInBox(p.x - r, p.y - r, p.x + r, p.y + r)) {
      const e = this.edge(id);
      if (!pred(e)) continue;
      const pr = projectOnSegment(p, this.node(e.a), this.node(e.b));
      const d = Math.sqrt(pr.d2);
      if (d <= r && (!best || d < best.dist)) best = { edge: id, x: pr.x, y: pr.y, t: Math.max(0, Math.min(1, pr.t)), dist: d };
    }
    return best;
  }

  // ---------------------------------------------------------------- low-level mutation

  private newNode(x: number, y: number, pinned: boolean): number {
    const id = this.ns.length;
    this.ns.push({ id, x, y, pinned });
    this.adj.push([]);
    this.nodeIndex.insert(id, { minX: x, minY: y, maxX: x, maxY: y });
    return id;
  }

  private edgeBox(a: GraphNode, b: GraphNode): Box {
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  }

  /** Adds an edge with no planarity checks (callers guarantee I2/I3). Merges into an existing a–b edge. */
  private addEdgeRaw(a: number, b: number, props: EdgeProps): number {
    const existing = this.edgeBetween(a, b);
    if (existing) {
      mergeProps(existing, props);
      return existing.id;
    }
    const id = this.es.length;
    const e: GraphEdge = { id, a, b, ...props };
    if (e.district === undefined) delete e.district;
    if (e.routeId === undefined) delete e.routeId;
    if (e.frame === undefined) delete e.frame;
    this.es.push(e);
    (this.adj[a] as number[]).push(id);
    (this.adj[b] as number[]).push(id);
    this.edgeIndex.insert(id, this.edgeBox(this.node(a), this.node(b)));
    return id;
  }

  removeEdge(id: number): void {
    const e = this.es[id];
    if (!e) return;
    this.es[id] = undefined;
    this.edgeIndex.remove(id);
    for (const n of [e.a, e.b]) {
      const list = this.adj[n] as number[];
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
    }
  }

  /** Removes a node with no incident edges. Returns whether it was removed. */
  removeNodeIfIsolated(n: number): boolean {
    if (!this.ns[n] || this.incident(n).length > 0) return false;
    this.ns[n] = undefined;
    this.nodeIndex.remove(n);
    return true;
  }

  /**
   * Replaces edge e by e.a–n and n–e.b (n on or within snap of e). When n is off the segment the
   * two halves bend slightly, so they are re-inserted with `connect` (keeps I2/I3 around them).
   */
  private splitEdgeThrough(eid: number, n: number): void {
    const e = this.edge(eid);
    if (e.a === n || e.b === n) return;
    const { a, b, id: _id, ...props } = e;
    this.removeEdge(eid);
    const A = this.node(a);
    const B = this.node(b);
    const onLine = projectOnSegment(this.node(n), A, B).d2 < 1e-12;
    if (onLine) {
      this.addEdgeRaw(a, n, props);
      this.addEdgeRaw(n, b, props);
    } else {
      this.connect(a, n, props, MAX_CONNECT_DEPTH);
      this.connect(n, b, props, MAX_CONNECT_DEPTH);
    }
  }

  /**
   * Bends non-fixed edge `eid` through node n (which may lie a few meters off it): the edge is
   * replaced by e.a–n and n–e.b, re-inserted with planar checks. Used to bring a street onto a node
   * that must not move (a pinned avenue end). Fixed edges are never bent (no-op).
   */
  routeEdgeThrough(eid: number, n: number): void {
    if (this.edge(eid).fixed) return;
    this.splitEdgeThrough(eid, n);
  }

  /**
   * Moves a free node (not pinned, no fixed edge) to p and re-inserts its edges with planar checks.
   * Callers keep the move small and check that the moved edges stay clear. Returns whether it moved.
   */
  shiftNode(n: number, p: Vec2): boolean {
    if (this.node(n).pinned || this.onFixed(n)) return false;
    this.moveNode(n, p);
    return this.hasNode(n);
  }

  /** I2 repair around node n: every other edge within snap of it is routed through it. */
  private absorb(n: number): void {
    let p = this.node(n);
    const s = this.tol.snap;
    // A fixed edge never bends: a free node near one moves onto it instead.
    if (!this.incident(n).some((id) => this.edge(id).fixed)) {
      let best: { x: number; y: number; d2: number } | undefined;
      for (const id of this.edgesInBox(p.x - s, p.y - s, p.x + s, p.y + s)) {
        const e = this.edge(id);
        if (!e.fixed || e.a === n || e.b === n) continue;
        const pr = projectOnSegment(p, this.node(e.a), this.node(e.b));
        if (pr.d2 <= s * s && pr.t > 0 && pr.t < 1 && (!best || pr.d2 < best.d2)) best = pr;
      }
      if (best && best.d2 > 0) {
        this.moveNode(n, { x: best.x, y: best.y });
        if (!this.hasNode(n)) return;
        p = this.node(n);
      }
    }
    for (const id of this.edgesInBox(p.x - s, p.y - s, p.x + s, p.y + s)) {
      const e = this.es[id];
      if (!e || e.a === n || e.b === n) continue;
      const pr = projectOnSegment(p, this.node(e.a), this.node(e.b));
      if (pr.d2 <= s * s && pr.t > 0 && pr.t < 1) this.splitEdgeThrough(id, n);
    }
  }

  /** Moves a node (by at most ~snap) and re-inserts its edges with planar checks. */
  private moveNode(n: number, p: Vec2): void {
    const node = this.node(n);
    const moved: { other: number; props: EdgeProps }[] = [];
    for (const id of [...this.incident(n)]) {
      const e = this.edge(id);
      const { a: _a, b: _b, id: _id, ...props } = e;
      moved.push({ other: this.other(e, n), props });
      this.removeEdge(id);
    }
    this.nodeIndex.remove(n);
    node.x = p.x;
    node.y = p.y;
    this.nodeIndex.insert(n, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
    for (const m of moved) if (this.hasNode(m.other)) this.connect(n, m.other, m.props, MAX_CONNECT_DEPTH);
  }

  /** Splits an edge at the point of it nearest to p and returns the new node (or a reused endpoint). */
  splitEdge(eid: number, p: Vec2): number {
    const e = this.edge(eid);
    const a = this.node(e.a);
    const b = this.node(e.b);
    const pr = projectOnSegment(p, a, b);
    const s2 = this.tol.snap ** 2;
    if ((pr.x - a.x) ** 2 + (pr.y - a.y) ** 2 <= s2) return e.a;
    if ((pr.x - b.x) ** 2 + (pr.y - b.y) ** 2 <= s2) return e.b;
    const near = this.nodesNear({ x: pr.x, y: pr.y }, this.tol.snap);
    if (near.length > 0) {
      const m = near[0] as number;
      this.splitEdgeThrough(eid, m);
      return m;
    }
    const n = this.newNode(pr.x, pr.y, false);
    this.splitEdgeThrough(eid, n);
    this.absorb(n);
    return n;
  }

  // ---------------------------------------------------------------- high-level insertion

  /**
   * Node at p: an existing node within snap, else a new node — placed exactly on an edge (fixed
   * edges first) when one passes within snap, which splits that edge (T junction).
   */
  addNode(p: Vec2, pinned = false): number {
    const s = this.tol.snap;
    const near = this.nodesNear(p, s);
    if (near.length > 0) {
      let best = near[0] as number;
      let bd = Infinity;
      for (const id of near) {
        const n = this.node(id);
        const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      if (pinned) this.node(best).pinned = true;
      return best;
    }
    const cands: { id: number; d2: number; x: number; y: number; fixed: boolean }[] = [];
    for (const id of this.edgesInBox(p.x - s, p.y - s, p.x + s, p.y + s)) {
      const e = this.edge(id);
      const pr = projectOnSegment(p, this.node(e.a), this.node(e.b));
      if (pr.d2 <= s * s && pr.t > 0 && pr.t < 1) cands.push({ id, d2: pr.d2, x: pr.x, y: pr.y, fixed: e.fixed });
    }
    if (cands.length === 0) return this.newNode(p.x, p.y, pinned);
    cands.sort((u, v) => (u.fixed === v.fixed ? u.d2 - v.d2 || u.id - v.id : u.fixed ? -1 : 1));
    const c = cands[0] as (typeof cands)[number];
    // The projection can land within snap of a node that p itself was not near (keeps I1).
    const nearProj = this.nodesNear({ x: c.x, y: c.y }, s);
    if (nearProj.length > 0) {
      const m = nearProj[0] as number;
      this.absorb(m);
      if (pinned) this.node(m).pinned = true;
      return m;
    }
    const n = this.newNode(c.x, c.y, pinned);
    this.splitEdgeThrough(c.id, n);
    this.absorb(n);
    return n;
  }

  /** Straight segment p→q with planar insertion. Returns the node path from p to q. */
  addSegment(p: Vec2, q: Vec2, props: EdgeProps): number[] {
    const a = this.addNode(p, props.fixed);
    const b = this.addNode(q, props.fixed);
    return this.connect(a, b, props);
  }

  /** Polyline with planar insertion. Returns the node path (consecutive duplicates removed). */
  addPolyline(points: readonly Vec2[], props: EdgeProps): number[] {
    const path: number[] = [];
    let prev: number | undefined;
    for (const p of points) {
      const n = this.addNode(p, props.fixed);
      if (prev !== undefined && prev !== n && this.hasNode(prev)) {
        const sub = this.connect(prev, n, props);
        for (const id of sub) if (path[path.length - 1] !== id) path.push(id);
      } else if (path[path.length - 1] !== n) {
        path.push(n);
      }
      prev = n;
    }
    return path;
  }

  /**
   * Straight edge between two existing nodes, split at every node or edge it meets on the way.
   * Returns the node path from a to b.
   */
  connect(a: number, b: number, props: EdgeProps, depth = 0): number[] {
    if (a === b) return [a];
    if (this.edgeBetween(a, b)) {
      this.addEdgeRaw(a, b, props);
      return [a, b];
    }
    // Hard stop: never loop (should not happen; the tests check planarity of the result).
    if (depth >= 2 * MAX_CONNECT_DEPTH) {
      this.addEdgeRaw(a, b, props);
      return [a, b];
    }
    const ev = this.firstEvent(a, b, props, depth >= MAX_CONNECT_DEPTH);
    if (ev === undefined) {
      this.addEdgeRaw(a, b, props);
      return [a, b];
    }
    if (ev === a || ev === b) {
      // The crossing resolved onto our own endpoint: an edge passes within snap of it. Route that
      // edge through the endpoint (restores I2) and try again.
      this.absorb(ev);
      return this.connect(a, b, props, depth + 1);
    }
    const left = this.connect(a, ev, props, depth + 1);
    const right = this.connect(ev, b, props, depth + 1);
    return [...left, ...right.slice(1)];
  }

  /**
   * First obstacle along a→b (smallest t): an existing node within snap of the segment, or a
   * proper crossing with an edge (resolved to a node: a nearby endpoint of the crossed edge when
   * the new edge may bend, else a new node splitting it). Returns that node, or undefined.
   */
  private firstEvent(a: number, b: number, props: EdgeProps, noReroute: boolean): number | undefined {
    const A = this.node(a);
    const B = this.node(b);
    const s = this.tol.snap;
    const box = this.edgeBox(A, B);
    let bestT = Infinity;
    let bestNode: number | undefined;
    let bestCross: { eid: number; t: number; u: number } | undefined;

    for (const id of this.nodeIndex.query({ minX: box.minX - s, minY: box.minY - s, maxX: box.maxX + s, maxY: box.maxY + s })) {
      if (id === a || id === b) continue;
      const pr = projectOnSegment(this.node(id), A, B);
      if (pr.d2 <= s * s && pr.t > 0 && pr.t < 1 && pr.t < bestT) {
        bestT = pr.t;
        bestNode = id;
      }
    }
    for (const id of this.edgesInBox(box.minX, box.minY, box.maxX, box.maxY)) {
      const e = this.edge(id);
      if (e.a === a || e.a === b || e.b === a || e.b === b) continue;
      const hit = segmentIntersection(A, B, this.node(e.a), this.node(e.b));
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestNode = undefined;
        bestCross = { eid: id, t: hit.t, u: hit.u };
      }
    }
    if (bestNode !== undefined) return bestNode;
    if (!bestCross) return undefined;

    const e = this.edge(bestCross.eid);
    const C = this.node(e.a);
    const D = this.node(e.b);
    const len = Math.hypot(D.x - C.x, D.y - C.y);
    const dc = bestCross.u * len;
    const dd = (1 - bestCross.u) * len;
    const X = { x: C.x + (D.x - C.x) * bestCross.u, y: C.y + (D.y - C.y) * bestCross.u };
    // Crossing within snap of an endpoint of the crossed edge: that endpoint is within snap of the
    // new segment too, so it is the event (keeps I1).
    if (dc <= s) return e.a;
    if (dd <= s) return e.b;
    if (!props.fixed && !noReroute) {
      const minE = this.minLengthOf(e.cls);
      if (Math.min(dc, dd) < minE) return dc <= dd ? e.a : e.b;
    }
    return this.splitEdge(bestCross.eid, X);
  }

  // ---------------------------------------------------------------- cleanup

  /**
   * Restores I1/I2 everywhere (insertion keeps them locally; fans of near-parallel edges meeting
   * at a node can leave a node within snap of a neighbour's edge). Routes every edge passing within
   * snap of a node through it and merges nodes closer than snap. Returns the number of fixes.
   */
  repair(): number {
    let fixes = 0;
    const s = this.tol.snap;
    for (let pass = 0; pass < 10; pass++) {
      let changed = 0;
      for (const n of this.nodes()) {
        if (!this.hasNode(n.id)) continue;
        const before = this.incident(n.id).length;
        const p = this.node(n.id);
        const near = this.edgesInBox(p.x - s, p.y - s, p.x + s, p.y + s).some((id) => {
          const e = this.edge(id);
          if (e.a === n.id || e.b === n.id) return false;
          const pr = projectOnSegment(p, this.node(e.a), this.node(e.b));
          return pr.d2 <= s * s && pr.t > 0 && pr.t < 1;
        });
        if (near) {
          this.absorb(n.id);
          if (this.hasNode(n.id) && this.incident(n.id).length !== before) changed++;
        }
      }
      for (const n of this.nodes()) {
        if (!this.hasNode(n.id)) continue;
        for (const m of this.nodesNear(this.node(n.id), s)) {
          if (m === n.id || !this.hasNode(m)) continue;
          const keepM = this.isRigid(m) && !this.isRigid(n.id);
          this.mergeNodes(keepM ? m : n.id, keepM ? n.id : m);
          changed++;
          if (!this.hasNode(n.id)) break;
        }
      }
      fixes += changed;
      if (changed === 0) break;
    }
    return fixes;
  }

  private isStreet = (e: GraphEdge): boolean => e.cls !== 'frame';

  /** A node that must not move: pinned, or joining fixed edges of different routes / directions. */
  private isRigid(n: number): boolean {
    const node = this.node(n);
    if (node.pinned) return true;
    const fixed = this.incident(n).map((id) => this.edge(id)).filter((e) => e.fixed);
    if (fixed.length <= 1) return false;
    if (fixed.length > 2) return true;
    const [e1, e2] = fixed as [GraphEdge, GraphEdge];
    if (e1.routeId !== e2.routeId) return true;
    const p1 = this.node(this.other(e1, n));
    const p2 = this.node(this.other(e2, n));
    const c = cross(p1.x - node.x, p1.y - node.y, p2.x - node.x, p2.y - node.y);
    const l = Math.hypot(p1.x - node.x, p1.y - node.y) * Math.hypot(p2.x - node.x, p2.y - node.y);
    return Math.abs(c) > 1e-6 * l;
  }

  private onFixed(n: number): boolean {
    return this.incident(n).some((id) => this.edge(id).fixed);
  }

  /** Moves every edge of `drop` onto `keep` (planar re-insertion) and deletes `drop`. */
  mergeNodes(keep: number, drop: number): void {
    if (keep === drop) return;
    const moved: { other: number; props: EdgeProps }[] = [];
    for (const id of [...this.incident(drop)]) {
      const e = this.edge(id);
      const { a: _a, b: _b, id: _id, ...props } = e;
      const other = this.other(e, drop);
      this.removeEdge(id);
      if (other !== keep) moved.push({ other, props });
    }
    this.removeNodeIfIsolated(drop);
    // Fixed edges first so a merged avenue is never rerouted around a street.
    moved.sort((p, q) => Number(q.props.fixed) - Number(p.props.fixed));
    for (const m of moved) if (this.hasNode(m.other)) this.connect(keep, m.other, m.props);
  }

  /**
   * Contracts street edges shorter than their class minimum. The node that stays is the one that
   * must not move (pinned / on an avenue); two such nodes are left alone. Returns how many edges
   * are still short.
   */
  collapseShortEdges(): number {
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const e of this.edges()) {
        if (!this.hasEdge(e.id) || !this.isStreet(e)) continue;
        if (this.length(e) >= this.minLengthOf(e.cls)) continue;
        const ra = this.isRigid(e.a);
        const rb = this.isRigid(e.b);
        if (ra && rb) continue;
        let keep: number;
        if (e.fixed) {
          keep = ra ? e.a : rb ? e.b : e.a;
        } else {
          const fa = ra || this.onFixed(e.a);
          const fb = rb || this.onFixed(e.b);
          if (fa && fb) continue;
          if (fa) keep = e.a;
          else if (fb) keep = e.b;
          else {
            const da = this.degree(e.a, this.isStreet);
            const db = this.degree(e.b, this.isStreet);
            keep = da > db ? e.a : db > da ? e.b : Math.min(e.a, e.b);
          }
        }
        this.mergeNodes(keep, keep === e.a ? e.b : e.a);
        changed = true;
      }
      if (!changed) break;
    }
    return this.edges().filter((e) => this.isStreet(e) && this.length(e) < this.minLengthOf(e.cls)).length;
  }

  /**
   * Removes dead-end chains of non-fixed streets shorter than `minLength` (a chain runs from a
   * street-degree-1 node through street-degree-2 nodes). Connectors left without a street are
   * removed too. Returns the number of edges removed.
   */
  pruneDangling(minLength: number): number {
    let removed = 0;
    for (let pass = 0; pass < 32; pass++) {
      let changed = false;
      for (const start of this.nodes()) {
        if (!this.hasNode(start.id) || this.degree(start.id, this.isStreet) !== 1) continue;
        const chain: number[] = [];
        let total = 0;
        let cur = start.id;
        let prevEdge = -1;
        let ok = true;
        for (;;) {
          const next = this.incident(cur).map((id) => this.edge(id)).find((e) => this.isStreet(e) && e.id !== prevEdge);
          if (!next) break;
          if (next.fixed) {
            ok = false;
            break;
          }
          chain.push(next.id);
          total += this.length(next);
          prevEdge = next.id;
          cur = this.other(next, cur);
          if (total >= minLength || this.degree(cur, this.isStreet) !== 2) break;
        }
        if (!ok || chain.length === 0 || total >= minLength) continue;
        for (const id of chain) {
          const e = this.edge(id);
          this.removeEdge(id);
          removed++;
          this.cleanupNode(e.a);
          this.cleanupNode(e.b);
        }
        changed = true;
      }
      if (!changed) break;
    }
    return removed;
  }

  /** Drops connectors hanging from a node with no street left, then the node if isolated. */
  private cleanupNode(n: number): void {
    if (!this.hasNode(n)) return;
    if (this.degree(n, this.isStreet) === 0) {
      for (const id of [...this.incident(n)]) {
        const e = this.edge(id);
        if (e.frame === 'connector' && e.cls === 'frame') {
          this.removeEdge(id);
          const o = this.other(e, n);
          if (this.hasNode(o) && this.incident(o).length === 0) this.removeNodeIfIsolated(o);
        }
      }
    }
    this.removeNodeIfIsolated(n);
  }

  /**
   * Removes non-fixed street edges whose connected street component contains no fixed edge
   * (streets that do not reach an avenue). Returns the number removed.
   */
  removeFloatingStreets(): number {
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as number;
      let c = x;
      while (c !== r) {
        const nx = parent.get(c) as number;
        parent.set(c, r);
        c = nx;
      }
      return r;
    };
    const union = (x: number, y: number): void => {
      const rx = find(x);
      const ry = find(y);
      if (rx !== ry) parent.set(Math.max(rx, ry), Math.min(rx, ry));
    };
    const streets = this.edges().filter(this.isStreet);
    for (const e of streets) {
      if (!parent.has(e.a)) parent.set(e.a, e.a);
      if (!parent.has(e.b)) parent.set(e.b, e.b);
      union(e.a, e.b);
    }
    const anchored = new Set<number>();
    for (const e of streets) if (e.fixed) anchored.add(find(e.a));
    let removed = 0;
    for (const e of streets) {
      if (e.fixed || anchored.has(find(e.a))) continue;
      this.removeEdge(e.id);
      removed++;
      this.cleanupNode(e.a);
      this.cleanupNode(e.b);
    }
    return removed;
  }

  /** Compact copy with ids renumbered 0..n-1 (creation order). */
  snapshot(): GraphSnapshot {
    const map = new Map<number, number>();
    const nodes: GraphSnapshot['nodes'] = [];
    for (const n of this.nodes()) {
      if (this.incident(n.id).length === 0) continue;
      map.set(n.id, nodes.length);
      nodes.push({ id: nodes.length, x: n.x, y: n.y, pinned: n.pinned });
    }
    const edges: GraphSnapshot['edges'] = this.edges().map((e, i) => {
      const { id: _id, a, b, ...props } = e;
      return { id: i, a: map.get(a) as number, b: map.get(b) as number, length: this.length(e), ...props };
    });
    return { nodes, edges };
  }
}
