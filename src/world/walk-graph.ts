/**
 * Pedestrian walk graph derived from the street network (issue #7, "Peatones").
 *
 * Input: the street graph (`StreetNetwork.graph`), after `joinTouchingDeadEnds` (dead ends that
 * stop inside a neighbouring street are joined to it). Frame edges are ignored. The arms of a street
 * node are its street edges, sorted counter-clockwise by direction. Each arm has a corner offset:
 *   - sidewalk street (sidewalk > 0: avenues, collectors, locals): width/2 + sidewalk/2, the
 *     sidewalk centerline. These streets get a sidewalk on each side ('sidewalk' edges).
 *   - alley (sidewalk 0): 0. Pedestrians walk its centerline ('alley' edges).
 *   - any other street (no sidewalk, e.g. the highway, or a class not in walkOn): width/2 + EDGE_GAP,
 *     no walkway along it.
 *
 * Corner between consecutive arms A, B (CCW) at a node, built only if A or B is a sidewalk street:
 *   - wedge < 180° − PARALLEL_TOL: miter, the intersection of A's left offset line with B's right
 *     offset line (one node);
 *   - wider wedges (near-straight, reflex, and the 360° of a dead end): an arc of radius
 *     R = max offset about the node, from where the circle meets A's left line to where it meets
 *     B's right line, in chords that keep ARC_CLEARANCE off both carriageways. A dead end thus
 *     wraps around the street end with a half ring; equal offsets on a straight run give one node.
 * Sidewalk edges along a street edge join the matching corners at its two ends. A corner next to an
 * alley lies on the alley centerline, so the alley walkway starts there (the two corners on each
 * side of an alley mouth are joined along it). At every node of degree >= 3, and where a sidewalk
 * street runs end to end into a street without sidewalk, each non-alley arm whose two corners exist
 * gets a 'crossing' edge between them.
 *
 * Carriageways below are those of the input network (what is rendered): bands of half width
 * width/2, rounded where a street continues, flat at dead ends. A walkway along a street that runs
 * across one is cut at its edges (the stretch inside becomes a 'crossing' if the walkway passes
 * through, else it is clipped at the kerb). Corner pieces (arcs, dead-end wraps) that reach a
 * neighbouring carriageway are dropped as a whole.
 *
 * Walk nodes on a non-alley carriageway (dead-end wraps that reach a neighbouring street) and nodes
 * rejected by `keep` (off playable land / outside the active area) are dropped with their edges.
 *
 * Deterministic: street nodes in id order, arms in angle order, nodes deduplicated by a 1 mm key.
 * `walkOn` (world.yaml `population.pedestrians.walk_on`) lists the street classes pedestrians walk:
 * a class not listed gets no walkway (its arms are treated like the highway's: no sidewalk along
 * it, crossings over it). The default is every street class (issue #7: sidewalks on all streets).
 */
import type { GraphSnapshot, StreetClass } from './streets/planar-graph.ts';
import type { Vec2 } from './vec.ts';
import { distance, lerp } from './vec.ts';
import type { Rng } from './rng.ts';
import { distanceToSegment } from './geometry.ts';

export type WalkEdgeKind = 'sidewalk' | 'crossing' | 'alley';
export type WalkEdge = { a: number; b: number; length: number; kind: WalkEdgeKind };
export type WalkGraph = { nodes: Vec2[]; edges: WalkEdge[]; adjacency: number[][] };
/**
 * Walk graph plus, per walk node, the street node it was built around: a node id of
 * `joinTouchingDeadEnds(network)` (= the network's ids, plus nodes appended by joins).
 */
export type StreetWalkGraph = WalkGraph & { origin: number[] };

/** Every street class: the default `walkOn` (sidewalks on all streets, alleys on the centerline). */
export const ALL_STREET_CLASSES: readonly StreetClass[] = ['avenue', 'collector', 'local', 'alley'];

/** Gap (m) between a no-sidewalk carriageway edge and the corner built against it. */
const EDGE_GAP = 0.5;
/** Wedges above 180° − this (rad) get an arc corner instead of a miter. */
const PARALLEL_TOL = (12 * Math.PI) / 180;
const MERGE = 0.05;
/** A joined dead end snaps to the other street's end node within this distance (m). */
const JOIN_SNAP = 3;
/** Least clearance (m) of an arc corner's chords from the carriageways at the node. */
const ARC_CLEARANCE = 0.1;
/** Largest angle (rad) of one arc-corner chord. */
const MAX_ARC_STEP = Math.PI / 4;
/** Sampling step (m) when splitting a walkway where it runs across a carriageway. */
const SPLIT_SAMPLE = 0.1;

type ArmType = 'sidewalk' | 'alley' | 'bare';
interface Arm {
  edge: number;
  dir: Vec2;
  angle: number;
  type: ArmType;
  /** Corner offset (m). */
  o: number;
  /** Carriageway half width (m). */
  half: number;
  length: number;
}
/** forPrev: node closing arm A's left side; forNext: node closing arm B's right side. */
interface Corner {
  forPrev: number;
  forNext: number;
}

interface Carriageway {
  a: Vec2;
  b: Vec2;
  half: number;
  /** Rounded at a (b): the street continues there (degree >= 2). A dead end is flat, like the ribbon. */
  capA: boolean;
  capB: boolean;
  /** Edge id (same in the network and in its joinTouchingDeadEnds copy). */
  edge: number;
}

/** Strictly inside (1 µm) a carriageway: the band of half width `half`, rounded where it continues. */
function insideCarriageway(p: Vec2, s: Carriageway): boolean {
  const abx = s.b.x - s.a.x;
  const aby = s.b.y - s.a.y;
  const t = ((p.x - s.a.x) * abx + (p.y - s.a.y) * aby) / (abx * abx + aby * aby);
  if ((t < 0 && !s.capA) || (t > 1 && !s.capB)) return false;
  return distanceToSegment(p, s.a, s.b) < s.half - 1e-6;
}

/**
 * Uniform grid over the non-alley carriageways: a band of half width width/2 along each edge,
 * rounded (disc) at nodes where the street continues, flat at dead ends.
 */
class CarriagewayIndex {
  readonly segs: Carriageway[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly cell: number;

  constructor(streets: GraphSnapshot, cell = 48) {
    this.cell = cell;
    const deg = new Array<number>(streets.nodes.length).fill(0);
    for (const e of streets.edges) {
      if (e.cls === 'frame') continue;
      deg[e.a] = (deg[e.a] as number) + 1;
      deg[e.b] = (deg[e.b] as number) + 1;
    }
    for (const e of streets.edges) {
      if (e.cls === 'frame' || e.cls === 'alley') continue;
      const a = streets.nodes[e.a] as Vec2;
      const b = streets.nodes[e.b] as Vec2;
      const capA = (deg[e.a] as number) >= 2;
      const capB = (deg[e.b] as number) >= 2;
      const id = this.segs.push({ a, b, half: e.width / 2, capA, capB, edge: e.id }) - 1;
      const r = e.width / 2;
      this.forCells(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, (k) => {
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      });
    }
  }

  private forCells(x0: number, y0: number, x1: number, y1: number, f: (k: number) => void): void {
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
      for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) f((ix + 0x8000) * 0x10000 + (iy + 0x8000));
    }
  }

  /** Strictly inside a carriageway (1 µm tolerance). */
  contains(p: Vec2): boolean {
    let found = false;
    this.forCells(p.x, p.y, p.x, p.y, (k) => {
      for (const id of this.cells.get(k) ?? []) {
        const s = this.segs[id] as Carriageway;
        if (!found && insideCarriageway(p, s)) found = true;
      }
    });
    return found;
  }

  /** Ids (ascending) of carriageways whose box meets the segment's box. */
  near(p: Vec2, q: Vec2): number[] {
    const out = new Set<number>();
    this.forCells(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y), (k) => {
      for (const id of this.cells.get(k) ?? []) out.add(id);
    });
    return [...out].sort((x, y) => x - y);
  }
}

/** Distance between segments pq and ab (0 if they cross). */
function segmentDistance(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number {
  const d1 = (q.x - p.x) * (a.y - p.y) - (q.y - p.y) * (a.x - p.x);
  const d2 = (q.x - p.x) * (b.y - p.y) - (q.y - p.y) * (b.x - p.x);
  const d3 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const d4 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(distanceToSegment(p, a, b), distanceToSegment(q, a, b), distanceToSegment(a, p, q), distanceToSegment(b, p, q));
}

/** Parameter intervals [t0, t1] of segment pq strictly inside carriageway s (sampled + bisection). */
function capsuleIntervals(p: Vec2, q: Vec2, s: Carriageway): [number, number][] {
  if (segmentDistance(p, q, s.a, s.b) >= s.half - 1e-6) return []; // the band lies inside the capsule
  const len = distance(p, q);
  const inside = (t: number): boolean => insideCarriageway(lerp(p, q, t), s);
  const n = Math.max(2, Math.ceil(len / SPLIT_SAMPLE));
  const refine = (lo: number, hi: number, loInside: boolean): number => {
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (inside(mid) === loInside) lo = mid;
      else hi = mid;
    }
    return loInside ? hi : lo; // the end just outside the capsule
  };
  const out: [number, number][] = [];
  let prev = inside(0);
  let start = prev ? 0 : -1;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const cur = inside(t);
    if (cur && !prev) start = refine((k - 1) / n, t, false);
    if (!cur && prev) out.push([start, refine((k - 1) / n, t, true)]);
    prev = cur;
  }
  if (prev) out.push([start, 1]);
  return out;
}

/**
 * Street graph as pedestrians see it: a dead end (degree 1) whose carriageway reaches another
 * street's sidewalk (end within other.width/2 + other.sidewalk + stub.width/2) without a junction is joined
 * to that street, so the walk graph treats it as the T / X it visibly is. The stub is extended along
 * its own direction to the other street's centerline (closest point if that line misses it): it
 * ends at that street's end node if the point is within JOIN_SNAP m of it, else at a new node
 * splitting that edge (appended after the existing nodes). Frame edges are kept
 * untouched. Dead ends are processed in id order against the current graph (deterministic).
 * Returns a copy with edges renumbered 0..n-1; node ids of the input are preserved.
 */
export function joinTouchingDeadEnds(input: GraphSnapshot): GraphSnapshot {
  const nodes = input.nodes.map((n) => ({ ...n }));
  const edges = input.edges.map((e) => ({ ...e }));
  const deg = new Array<number>(nodes.length).fill(0);
  for (const e of edges) {
    if (e.cls === 'frame') continue;
    deg[e.a] = (deg[e.a] as number) + 1;
    deg[e.b] = (deg[e.b] as number) + 1;
  }
  const deadEnds = nodes.filter((n) => deg[n.id] === 1).map((n) => n.id);
  for (const v of deadEnds) {
    if (deg[v] !== 1) continue;
    const stub = edges.find((e) => e.cls !== 'frame' && (e.a === v || e.b === v));
    if (!stub) continue;
    const p = nodes[v] as Vec2;
    let best = -1;
    let bestD = Infinity;
    edges.forEach((e, i) => {
      if (e.cls === 'frame' || e === stub || e.a === v || e.b === v) return;
      const d = distanceToSegment(p, nodes[e.a] as Vec2, nodes[e.b] as Vec2);
      if (d < e.width / 2 + e.sidewalk + stub.width / 2 && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) continue;
    const other = edges[best] as (typeof edges)[number];
    const a = nodes[other.a] as Vec2;
    const b = nodes[other.b] as Vec2;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const keepEnd = stub.a === v ? stub.b : stub.a;
    // Extend the stub along its own direction to the other street's centerline (so the joined stub
    // covers the original one); fall back to the closest point if that line misses the segment.
    const k = nodes[keepEnd] as Vec2;
    const sl = distance(p, k);
    const dx = (p.x - k.x) / sl;
    const dy = (p.y - k.y) / sl;
    const reach = other.width / 2 + other.sidewalk + stub.width / 2;
    const den = dx * aby - dy * abx;
    let t = -1;
    if (Math.abs(den) > 1e-9) {
      const sAlong = ((a.x - p.x) * aby - (a.y - p.y) * abx) / den;
      const u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
      if (u >= 0 && u <= 1 && sAlong >= -reach && sAlong <= 2 * reach) t = u;
    }
    if (t < 0) t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
    const q = { x: a.x + abx * t, y: a.y + aby * t };
    let target: number;
    if (distance(q, a) <= JOIN_SNAP) target = other.a;
    else if (distance(q, b) <= JOIN_SNAP) target = other.b;
    else {
      target = nodes.push({ id: nodes.length, x: q.x, y: q.y, pinned: false }) - 1;
      deg.push(2);
      edges.push({ ...other, a: target, b: other.b, length: distance(q, b) });
      other.b = target;
      other.length = distance(a, q);
    }
    if (target === keepEnd) continue;
    if (stub.a === v) stub.a = target;
    else stub.b = target;
    stub.length = distance(nodes[stub.a] as Vec2, nodes[stub.b] as Vec2);
    deg[v] = 0;
    deg[target] = (deg[target] as number) + 1;
  }
  return { nodes, edges: edges.map((e, id) => ({ ...e, id })) };
}

/**
 * `keep` filters walk nodes (e.g. `slice.isPlayableLand`): nodes it rejects and their edges are
 * dropped (dead-end wraps and corners past the active-area border or off land).
 */
export function buildWalkGraph(
  network: GraphSnapshot,
  keep: (p: Vec2) => boolean = () => true,
  walkOn: readonly string[] = ALL_STREET_CLASSES,
): StreetWalkGraph {
  const walked = new Set(walkOn);
  /** Walkway along this street edge: 'sidewalk' (both sides), 'alley' (centerline) or none. */
  const walkwayOf = (e: GraphSnapshot['edges'][number]): ArmType => {
    if (!walked.has(e.cls)) return 'bare';
    return e.sidewalk > 0 ? 'sidewalk' : e.cls === 'alley' ? 'alley' : 'bare';
  };
  const streets = joinTouchingDeadEnds(network);
  const nodes: Vec2[] = [];
  const origin: number[] = [];
  const edges: WalkEdge[] = [];
  /** Per edge: built along a street edge (true) or around a node (arcs, wraps, mouths, crossings). */
  const along: boolean[] = [];
  /** Per edge: arc corner it belongs to (-1 = none); an arc is kept or dropped as a whole. */
  const group: number[] = [];
  let arcGroup = -1;
  let groupCount = 0;
  const keyToId = new Map<string, number>();
  const edgeKeys = new Set<string>();

  const addNode = (p: Vec2, from: number): number => {
    const key = `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
    const found = keyToId.get(key);
    if (found !== undefined) return found;
    const id = nodes.push({ x: p.x, y: p.y }) - 1;
    origin.push(from);
    keyToId.set(key, id);
    return id;
  };
  const addEdge = (a: number, b: number, kind: WalkEdgeKind, isAlong = false): void => {
    if (a === b) return;
    const len = distance(nodes[a] as Vec2, nodes[b] as Vec2);
    if (len < 1e-6) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ a, b, length: len, kind });
    along.push(isAlong);
    group.push(arcGroup);
  };

  // Arms per street node.
  const arms: Arm[][] = streets.nodes.map(() => []);
  for (const e of streets.edges) {
    if (e.cls === 'frame') continue;
    const pa = streets.nodes[e.a] as Vec2;
    const pb = streets.nodes[e.b] as Vec2;
    const len = distance(pa, pb);
    if (len < 1e-9) continue;
    const type = walkwayOf(e);
    const half = e.width / 2;
    const o = type === 'sidewalk' ? half + e.sidewalk / 2 : type === 'alley' ? 0 : half + EDGE_GAP;
    for (const [at, to, id] of [[pa, pb, e.a], [pb, pa, e.b]] as const) {
      const dir = { x: (to.x - at.x) / len, y: (to.y - at.y) / len };
      (arms[id] as Arm[]).push({ edge: e.id, dir, angle: Math.atan2(dir.y, dir.x), type, o, half, length: len });
    }
  }
  for (const list of arms) list.sort((p, q) => p.angle - q.angle || p.edge - q.edge);

  function makeCorner(v: Vec2, from: number, A: Arm, B: Arm, wedge: number): Corner {
    const nA = { x: -A.dir.y, y: A.dir.x };
    const nB = { x: -B.dir.y, y: B.dir.x };
    const pA = { x: v.x + nA.x * A.o, y: v.y + nA.y * A.o }; // A's left line, at the node
    const pB = { x: v.x - nB.x * B.o, y: v.y - nB.y * B.o }; // B's right line, at the node
    const stepKind: WalkEdgeKind = A.type === 'alley' || B.type === 'alley' ? 'alley' : 'sidewalk';

    if (wedge >= Math.PI - PARALLEL_TOL) {
      // Near-parallel, reflex or dead end: arc of radius R = max offset about the node, from where
      // the circle meets A's left line (ahead along A) to where it meets B's right line (ahead
      // along B). Never cuts either carriageway's end; a dead end becomes a half ring.
      const R = Math.max(A.o, B.o);
      const alongA = Math.sqrt(Math.max(0, R * R - A.o * A.o));
      const alongB = Math.sqrt(Math.max(0, R * R - B.o * B.o));
      const start = { x: pA.x + A.dir.x * alongA, y: pA.y + A.dir.y * alongA };
      const end = { x: pB.x + B.dir.x * alongB, y: pB.y + B.dir.y * alongB };
      if (distance(start, end) < MERGE) {
        const id = addNode(lerp(start, end, 0.5), from);
        return { forPrev: id, forNext: id };
      }
      const a0 = Math.atan2(start.y - v.y, start.x - v.x);
      let delta = Math.atan2(end.y - v.y, end.x - v.x) - a0;
      if (A === B) delta = Math.PI;
      else {
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta <= -Math.PI) delta += 2 * Math.PI;
      }
      const half = Math.max(A.half, B.half);
      const maxStep = Math.min(MAX_ARC_STEP, 2 * Math.acos(Math.min(1, (half + ARC_CLEARANCE) / R)));
      const steps = Math.max(1, Math.ceil(Math.abs(delta) / Math.max(maxStep, 1e-3)));
      const ids = [addNode(start, from)];
      for (let k = 1; k < steps; k++) {
        const ang = a0 + (delta * k) / steps;
        ids.push(addNode({ x: v.x + Math.cos(ang) * R, y: v.y + Math.sin(ang) * R }, from));
      }
      ids.push(addNode(end, from));
      arcGroup = groupCount++;
      for (let k = 0; k < ids.length - 1; k++) addEdge(ids[k] as number, ids[k + 1] as number, stepKind);
      arcGroup = -1;
      return { forPrev: ids[0] as number, forNext: ids[ids.length - 1] as number };
    }

    // Miter: pA + s·dirA = pB + t·dirB.
    const den = A.dir.x * B.dir.y - A.dir.y * B.dir.x;
    const rx = pB.x - pA.x;
    const ry = pB.y - pA.y;
    const s = (rx * B.dir.y - ry * B.dir.x) / den;
    const id = addNode({ x: pA.x + A.dir.x * s, y: pA.y + A.dir.y * s }, from);
    return { forPrev: id, forNext: id };
  }

  // Per street node: corners by pair index i = (arm i, arm i+1); alley walkway ends by edge id.
  const corners: (Corner | undefined)[][] = [];
  const alleyEnd: Map<number, number>[] = [];
  const armIndex: Map<number, number>[] = [];

  streets.nodes.forEach((sn, v) => {
    const list = arms[v] as Arm[];
    const vp: Vec2 = { x: sn.x, y: sn.y };
    const n = list.length;
    const cs: (Corner | undefined)[] = new Array<Corner | undefined>(n).fill(undefined);
    const ends = new Map<number, number>();
    const index = new Map<number, number>();
    list.forEach((arm, i) => index.set(arm.edge, i));
    corners.push(cs);
    alleyEnd.push(ends);
    armIndex.push(index);
    if (n === 0) return;

    for (let i = 0; i < n; i++) {
      const A = list[i] as Arm;
      const B = list[(i + 1) % n] as Arm;
      if (A.type !== 'sidewalk' && B.type !== 'sidewalk') continue;
      let wedge = n === 1 ? 2 * Math.PI : B.angle - A.angle;
      if (wedge <= 0) wedge += 2 * Math.PI;
      cs[i] = makeCorner(vp, v, A, B, wedge);
    }

    // Alley walkway ends: the corner(s) on its centerline, else the node (or past a bare street).
    list.forEach((arm, i) => {
      if (arm.type !== 'alley') return;
      const before = cs[(i - 1 + n) % n]?.forNext;
      const after = cs[i]?.forPrev;
      const along = (id: number): number => {
        const p = nodes[id] as Vec2;
        return (p.x - vp.x) * arm.dir.x + (p.y - vp.y) * arm.dir.y;
      };
      if (before !== undefined && after !== undefined) {
        addEdge(before, after, 'alley');
        ends.set(arm.edge, along(before) >= along(after) ? before : after);
        return;
      }
      if (before !== undefined || after !== undefined) {
        ends.set(arm.edge, (before ?? after) as number);
        return;
      }
      let m = 0;
      for (const other of list) {
        if (other.type !== 'bare') continue;
        const c = arm.dir.x * other.dir.x + arm.dir.y * other.dir.y;
        const sn2 = Math.abs(arm.dir.x * other.dir.y - arm.dir.y * other.dir.x);
        m = Math.max(m, c > 0 ? other.o / Math.max(sn2, 0.2) : other.o);
      }
      m = Math.min(m, arm.length * 0.45);
      ends.set(arm.edge, addNode({ x: vp.x + arm.dir.x * m, y: vp.y + arm.dir.y * m }, v));
    });

    // Crossings.
    const bareEnd = n === 2 && list.some((a) => a.type === 'bare') && list.some((a) => a.type === 'sidewalk');
    if (n >= 3 || bareEnd) {
      list.forEach((arm, i) => {
        if (arm.type === 'alley') return;
        if (bareEnd && arm.type !== 'sidewalk') return;
        const before = cs[(i - 1 + n) % n];
        const after = cs[i];
        if (before && after) addEdge(before.forNext, after.forPrev, 'crossing');
      });
    }
  });

  // Walkways along street edges.
  for (const e of streets.edges) {
    if (e.cls === 'frame') continue;
    const ia = armIndex[e.a]?.get(e.id);
    const ib = armIndex[e.b]?.get(e.id);
    if (ia === undefined || ib === undefined) continue;
    const walkway = walkwayOf(e);
    if (walkway === 'sidewalk') {
      const ca = corners[e.a] as (Corner | undefined)[];
      const cb = corners[e.b] as (Corner | undefined)[];
      const aLeft = ca[ia];
      const aRight = ca[(ia - 1 + ca.length) % ca.length];
      const bLeft = cb[ib];
      const bRight = cb[(ib - 1 + cb.length) % cb.length];
      // Left of a→b = right of b→a.
      if (aLeft && bRight) addEdge(aLeft.forPrev, bRight.forNext, 'sidewalk', true);
      if (aRight && bLeft) addEdge(aRight.forNext, bLeft.forPrev, 'sidewalk', true);
    } else if (walkway === 'alley') {
      const a = alleyEnd[e.a]?.get(e.id);
      const b = alleyEnd[e.b]?.get(e.id);
      if (a !== undefined && b !== undefined) addEdge(a, b, 'alley', true);
    }
  }

  const carriageways = new CarriagewayIndex(network);
  // A walkway along a street that still runs across a rendered (network) carriageway is cut at its
  // edges. The stretch inside becomes a 'crossing' (it survives only if both its ends do, i.e. the
  // walkway passes right through), its nodes attributed to the nearer end of the crossed edge as
  // joined; a walkway ending inside a carriageway is thus clipped at the kerb.
  const split: WalkEdge[] = [];
  const onBoundary = new Set<number>();
  const intrudes = (e: WalkEdge): boolean => {
    const p = nodes[e.a] as Vec2;
    const q = nodes[e.b] as Vec2;
    return carriageways.near(p, q).some((id) => capsuleIntervals(p, q, carriageways.segs[id] as Carriageway).length > 0);
  };
  const droppedGroups = new Set<number>();
  edges.forEach((e, ei) => {
    if ((group[ei] as number) >= 0 && intrudes(e)) droppedGroups.add(group[ei] as number);
  });
  edges.forEach((e, ei) => {
    if (droppedGroups.has(group[ei] as number)) return;
    const p = nodes[e.a] as Vec2;
    const q = nodes[e.b] as Vec2;
    let spans: { t0: number; t1: number; at: number }[] = [];
    if (e.kind !== 'crossing') {
      for (const id of carriageways.near(p, q)) {
        const s = carriageways.segs[id] as Carriageway;
        // Attribute the crossing to the nearer end of that street edge as joined (a joined stub's
        // end is the junction it was joined to).
        const je = streets.edges[s.edge] as GraphSnapshot['edges'][number];
        for (const [t0, t1] of capsuleIntervals(p, q, s)) {
          const mid = lerp(p, q, (t0 + t1) / 2);
          const at = distance(mid, streets.nodes[je.a] as Vec2) <= distance(mid, streets.nodes[je.b] as Vec2) ? je.a : je.b;
          spans.push({ t0, t1, at });
        }
      }
    }
    // A corner piece (arc, dead-end wrap, alley mouth) reaching a neighbouring street is dropped.
    if (spans.length > 0 && !along[ei]) return;
    if (spans.length === 0) {
      split.push(e);
      return;
    }
    spans = spans.sort((x, y) => x.t0 - y.t0 || x.at - y.at);
    const merged: { t0: number; t1: number; at: number }[] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp.t0 <= last.t1) last.t1 = Math.max(last.t1, sp.t1);
      else merged.push({ ...sp });
    }
    let cur = e.a;
    for (const sp of merged) {
      const x0 = sp.t0 <= 0 ? e.a : addNode(lerp(p, q, sp.t0), sp.at);
      const x1 = sp.t1 >= 1 ? e.b : addNode(lerp(p, q, sp.t1), sp.at);
      if (sp.t0 > 0) onBoundary.add(x0);
      if (sp.t1 < 1) onBoundary.add(x1);
      if (cur !== x0) split.push({ a: cur, b: x0, length: distance(nodes[cur] as Vec2, nodes[x0] as Vec2), kind: e.kind });
      split.push({ a: x0, b: x1, length: distance(nodes[x0] as Vec2, nodes[x1] as Vec2), kind: 'crossing' });
      cur = x1;
    }
    if (cur !== e.b) split.push({ a: cur, b: e.b, length: distance(nodes[cur] as Vec2, nodes[e.b] as Vec2), kind: e.kind });
  });

  // Drop nodes on a carriageway or rejected by `keep`, with their edges; then unused nodes; reindex.
  // (Split points sit on a carriageway's edge by construction.)
  const alive = nodes.map((p, i) => keep(p) && (onBoundary.has(i) || !carriageways.contains(p)));
  const kept = split.filter((e) => e.length > 1e-6 && alive[e.a] && alive[e.b]);
  const used = new Array<boolean>(nodes.length).fill(false);
  for (const e of kept) {
    used[e.a] = true;
    used[e.b] = true;
  }
  const remap = new Array<number>(nodes.length).fill(-1);
  const outNodes: Vec2[] = [];
  const outOrigin: number[] = [];
  nodes.forEach((p, i) => {
    if (!used[i]) return;
    remap[i] = outNodes.push(p) - 1;
    outOrigin.push(origin[i] as number);
  });
  const outEdges: WalkEdge[] = kept.map((e) => ({ ...e, a: remap[e.a] as number, b: remap[e.b] as number }));
  const adjacency: number[][] = outNodes.map(() => []);
  outEdges.forEach((e, id) => {
    (adjacency[e.a] as number[]).push(id);
    (adjacency[e.b] as number[]).push(id);
  });
  return { nodes: outNodes, edges: outEdges, adjacency, origin: outOrigin };
}

export function otherEnd(graph: WalkGraph, edgeId: number, node: number): number {
  const e = graph.edges[edgeId] as WalkEdge;
  return e.a === node ? e.b : e.a;
}

/** Random edge at the node, never straight back unless that is the only option (dead end). */
export function nextEdge(graph: WalkGraph, arrivedVia: number, atNode: number, rng: Rng): number {
  const options = (graph.adjacency[atNode] as number[]).filter((id) => id !== arrivedVia);
  if (options.length === 0) return arrivedVia;
  return rng.pick(options);
}

export function pointOnEdge(graph: WalkGraph, edgeId: number, t: number): Vec2 {
  const e = graph.edges[edgeId] as WalkEdge;
  return lerp(graph.nodes[e.a] as Vec2, graph.nodes[e.b] as Vec2, t);
}
