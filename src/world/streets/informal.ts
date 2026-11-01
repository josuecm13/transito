/**
 * Organic growth for `style: informal` districts (issue #7, S4), after Parish & Müller (2001):
 * a priority queue of road proposals grows the network outwards from the streets that already
 * exist (avenues, formal streets), and every proposal is checked against local constraints before
 * it becomes a street.
 *
 * Seeds: points along every street already in the district (in practice the avenues), spaced by
 * `growth.segment_length`, each proposing a street roughly perpendicular to it on both sides.
 *
 * A proposal = (start point, heading, class). Processing one:
 *   1. Length L from `segment_length` (alleys: × alleyLengthRatio); heading turned by up to
 *      ±informalTurn (the slight winding of a self-built street).
 *   2. Local constraints, in order (radius r = `snap_radius`):
 *      a. crossing — the segment, extended by r, crosses a street → cut there (T junction);
 *      b. node     — the end is within r of a node → end on that node;
 *      c. edge     — the end is within r of a street → extend / bend onto it (T junction);
 *      d. free     — otherwise the end stays open and keeps growing.
 *      Any junction (start or end) where the new street meets another at less than `min_angle`
 *      is pruned: the proposal is dropped (rule 4 of the brief). A new junction within
 *      informalJunctionGap of an existing one moves onto it (if the bend stays within
 *      informalSnapTurn and the path is clear), else the proposal is dropped: no slivers between
 *      near-duplicate junctions.
 *   3. Region: the segment must stay where `allowed` holds (district, playable land, clearance).
 *      Where it leaves, it is cut at the last allowed sample and the end is linked to the frame
 *      (`connectToFrame`) so the block there closes.
 *   4. Separation: a segment that would run within informalSeparation of a near-parallel street
 *      is dropped (no doubled streets). Alleys use alleySeparationRatio × that.
 *   5. Accepted free ends continue (same class; a street stops there, leaving a dead end, with
 *      informalStopProbability) and branch to each side with
 *      `branch_probability`, at 90° ± informalBranchTurn, delayed in the queue so the street
 *      they hang from grows first; when both sides branch, the second leaves from mid-segment
 *      (staggered T junctions). A branch is an alley with `alley_probability` (alleys only
 *      spawn alleys). Alleys grow 1..alleyMaxSegments segments and may dead-end. A local branch is
 *      a spur with informalSpurProbability: 1..informalSpurSegments segments of
 *      segment_length × informalSpurLengthRatio, then it stops
 *      (a dead end, unless it reached a street) — the cul-de-sacs of an informal barrio.
 * Junction ends do not continue (P&M), except that a street crossing another continues past it
 * with informalCrossThrough (X junctions).
 *
 * Classes: informal growth makes `local` streets and `alley`s only (no collectors: the avenues are
 * the barrio's through roads).
 * Phases: all locals grow first; alleys are queued aside and grown afterwards in the
 * finished street network, so a street never ends on an alley.
 * Coverage: when the queue empties, any allowed point farther than informalCoverageGap from every
 * street gets a proposal from the nearest street towards it (still connected, never floating).
 * Infill: then every face larger than informalInfillArea gets a straight cross street through its
 * middle (or ±20% / ±35% along it), perpendicular to its long axis, from street side to street
 * side, under the same angle / region / junction-gap / separation rules (long strips get cross
 * streets; dead ends inside the face are crossed); if none fits, a street is grown into the face
 * from its side.
 *
 * Deterministic: only `ctx.rng` (forked per phase); every proposal draws the same number of values
 * in the same order before any rule runs; the queue breaks ties by insertion order.
 */
import type { Vec2 } from '../vec.ts';
import type { Rng } from '../rng.ts';
import type { GraphEdge } from './planar-graph.ts';
import { projectOnSegment, segmentIntersection } from './planar-graph.ts';
import { extractFaces } from './faces.ts';
import type { InformalGrower } from './generate.ts';

type GrowClass = 'local' | 'alley';

interface Proposal {
  p: Vec2;
  theta: number;
  cls: GrowClass;
  /** Priority (smaller first). */
  t: number;
  /** Segments left before the street stops (alleys); Infinity for locals. */
  left: number;
  /** Continuation (heading turned by the jitter) vs fresh branch / seed (heading as given). */
  turn: boolean;
  /** Short dead-end-prone branch (shorter segments). */
  spur?: boolean;
}

interface QueueItem {
  t: number;
  seq: number;
  prop: Proposal;
}

/** Binary min-heap on (t, seq). */
class ProposalQueue {
  private readonly items: QueueItem[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(prop: Proposal): void {
    const it = { t: prop.t, seq: this.seq++, prop };
    const a = this.items;
    a.push(it);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i] as QueueItem, a[p] as QueueItem)) break;
      [a[i], a[p]] = [a[p] as QueueItem, a[i] as QueueItem];
      i = p;
    }
  }

  pop(): Proposal | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0] as QueueItem;
    const last = a.pop() as QueueItem;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l] as QueueItem, a[m] as QueueItem)) m = l;
        if (r < a.length && less(a[r] as QueueItem, a[m] as QueueItem)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as QueueItem, a[i] as QueueItem];
        i = m;
      }
    }
    return top.prop;
  }
}

const less = (x: QueueItem, y: QueueItem): boolean => x.t < y.t || (x.t === y.t && x.seq < y.seq);

const DEG = Math.PI / 180;
/** Infill cut positions along a face's long axis, as fractions of its length from the centroid. */
const INFILL_OFFSETS = [0, -0.2, 0.2, -0.35, 0.35];
const isStreet = (e: GraphEdge): boolean => e.cls !== 'frame';

type EndKind = 'crossing' | 'node' | 'edge' | 'free' | 'boundary';

export const growOrganicDistrict: InformalGrower = (ctx) => {
  const { graph, region, params, style } = ctx;
  const g = style.growth;
  const [lenMin, lenMax] = g.segmentLength;
  const snapR = g.snapRadius;
  const sinMin = Math.sin(g.minAngle * DEG);
  const cosMin = Math.cos(g.minAngle * DEG);
  const cosPar = Math.cos(params.informalParallelAngle * DEG);
  const snapTol = graph.tol.snap;
  const box = region.box;
  const inDistrictStreet = (e: GraphEdge) => isStreet(e) && (e.fixed || e.district === region.id);

  const minLen = (cls: GrowClass) => (cls === 'alley' ? Math.max(graph.tol.minLengthAlley, params.alleyMinSegment) : graph.tol.minLength + 2);
  const sepOf = (cls: GrowClass) => (cls === 'alley' ? params.informalSeparation * params.alleySeparationRatio : params.informalSeparation);

  /** Unit directions from p along every street passing within snap of p (both ways when p is mid-edge). */
  const armsAt = (p: Vec2): Vec2[] => {
    const out: Vec2[] = [];
    for (const id of graph.edgesInBox(p.x - snapTol, p.y - snapTol, p.x + snapTol, p.y + snapTol)) {
      const e = graph.edge(id);
      if (!isStreet(e)) continue;
      const a = graph.node(e.a);
      const b = graph.node(e.b);
      if (projectOnSegment(p, a, b).d2 > snapTol * snapTol) continue;
      for (const q of [a, b]) {
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const l = Math.hypot(dx, dy);
        if (l > snapTol) out.push({ x: dx / l, y: dy / l });
      }
    }
    return out;
  };
  /** Does a street leaving p along unit d meet every street at p at >= min_angle? */
  const angleOk = (p: Vec2, d: Vec2): boolean => armsAt(p).every((u) => u.x * d.x + u.y * d.y < cosMin);

  const isMajor = (e: GraphEdge) => isStreet(e) && e.cls !== 'alley';
  /** Junction nodes (>= 3 non-alley streets) within r of p, farther than snap, nearest first. */
  const junctionsNear = (p: Vec2, r: number): number[] =>
    graph
      .nodesNear(p, r)
      .filter((id) => {
        const n = graph.node(id);
        return Math.hypot(n.x - p.x, n.y - p.y) > snapTol && graph.degree(id, isMajor) >= 3;
      })
      .sort((u, v) => {
        const a = graph.node(u);
        const b = graph.node(v);
        return Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || u - v;
      });
  /** Non-alley streets meeting at p after a new street joins it (p a node, mid-edge, or free). */
  const majorArmsAt = (p: Vec2): number => {
    const ids = graph.nodesNear(p, snapTol);
    if (ids.length > 0) return graph.degree(ids[0] as number, isMajor);
    return graph.nearestEdge(p, snapTol, isMajor) ? 2 : 0;
  };

  /** Street edge ids touching p (within snap). */
  const touching = (p: Vec2): Set<number> => {
    const s = new Set<number>();
    for (const id of graph.edgesInBox(p.x - snapTol, p.y - snapTol, p.x + snapTol, p.y + snapTol)) {
      const e = graph.edge(id);
      if (projectOnSegment(p, graph.node(e.a), graph.node(e.b)).d2 <= snapTol * snapTol) s.add(id);
    }
    return s;
  };

  /** First crossing of a→b with a street not touching a (by distance from a > snap). */
  const firstCrossing = (a: Vec2, b: Vec2, skip: Set<number>): { t: number; point: Vec2; edge: GraphEdge } | undefined => {
    let best: { t: number; point: Vec2; edge: GraphEdge } | undefined;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (const id of graph.edgesInBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
      if (skip.has(id)) continue;
      const e = graph.edge(id);
      if (!isStreet(e)) continue;
      const hit = segmentIntersection(a, b, graph.node(e.a), graph.node(e.b));
      if (!hit || hit.t * len <= snapTol) continue;
      if (!best || hit.t < best.t) best = { t: hit.t, point: { x: a.x + (b.x - a.x) * hit.t, y: a.y + (b.y - a.y) * hit.t }, edge: e };
    }
    return best;
  };

  /** Is a→b free of crossings (other than at a / b themselves)? */
  const clearPath = (a: Vec2, b: Vec2, skip: Set<number>): boolean => {
    const hit = firstCrossing(a, b, skip);
    if (!hit) return true;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return (1 - hit.t) * len <= snapTol;
  };

  /**
   * Allowed for a grown street: ctx.allowed, and not within 2 × snap of the active-area border
   * (an end that close would be snapped onto the border, whose district is the neighbour's).
   */
  const okAt = (cls: GrowClass, p: Vec2): boolean => ctx.allowed(cls, p) && region.nearestFrame(p, 2 * snapTol, true)?.kind !== 'area';
  /** Fraction (0..1] of a→b that stays allowed (sampled every 4 m); 1 = all of it. */
  const allowedUpTo = (cls: GrowClass, a: Vec2, b: Vec2): number => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / 4));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      if (!okAt(cls, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })) return (i - 1) / n;
    }
    return 1;
  };

  /** Would a→b run alongside a near-parallel street closer than the class separation? */
  const crowded = (cls: GrowClass, a: Vec2, b: Vec2, skipStart: Set<number>, junctionEnd: boolean): boolean => {
    const sep = sepOf(cls);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) return false;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const endSkip = junctionEnd ? sep * 0.75 : 0;
    for (let s = Math.min(sep * 0.5, len); s <= len - endSkip + 1e-9; s += 5) {
      const p = { x: a.x + d.x * s, y: a.y + d.y * s };
      const near = graph.nearestEdge(p, sep, (e) => isStreet(e) && !skipStart.has(e.id));
      if (!near) continue;
      const e = graph.edge(near.edge);
      const pa = graph.node(e.a);
      const pb = graph.node(e.b);
      const el = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (el === 0) continue;
      if (Math.abs((d.x * (pb.x - pa.x) + d.y * (pb.y - pa.y)) / el) > cosPar) return true;
    }
    return false;
  };

  const queue = new ProposalQueue();
  const alleys: Proposal[] = [];
  let processed = 0;
  const budget = params.informalMaxProposals;

  let phase: 'streets' | 'alleys' = 'streets';
  const enqueue = (prop: Proposal) => {
    if (prop.cls === 'alley' && phase === 'streets') alleys.push(prop);
    else queue.push(prop);
  };
  let rng: Rng = ctx.rng.fork('organic:streets');

  /** Processes one proposal. Returns whether a street segment was added. */
  const grow = (prop: Proposal): boolean => {
    // Fixed draw order: every proposal draws these before any rule runs.
    const rLen = rng.next();
    const rTurn = rng.next();
    const rBranch = [rng.next(), rng.next()] as const;
    const rAlley = [rng.next(), rng.next()] as const;
    const rBranchTurn = [rng.next(), rng.next()] as const;
    const rDelay = [rng.next(), rng.next()] as const;
    const rAlleySegs = [rng.next(), rng.next()] as const;
    const rThrough = rng.next();
    const rStop = rng.next();
    const rSpur = [rng.next(), rng.next()] as const;

    const cls = prop.cls;
    const A = prop.p;
    const L = (lenMin + (lenMax - lenMin) * rLen) * (cls === 'alley' ? params.alleyLengthRatio : prop.spur ? params.informalSpurLengthRatio : 1);
    const theta = prop.turn ? prop.theta + (rTurn * 2 - 1) * params.informalTurn * DEG : prop.theta;
    let d = { x: Math.cos(theta), y: Math.sin(theta) };
    if (!angleOk(A, d)) return false;
    const skipA = touching(A);
    const E = { x: A.x + d.x * L, y: A.y + d.y * L };

    // a. crossing (segment extended by the snap radius)
    let kind: EndKind = 'free';
    let target = E;
    let crossedEdge: GraphEdge | undefined;
    const ext = { x: A.x + d.x * (L + snapR), y: A.y + d.y * (L + snapR) };
    const hit = firstCrossing(A, ext, skipA);
    if (hit) {
      kind = 'crossing';
      target = hit.point;
      crossedEdge = hit.edge;
    } else {
      // b. node within the snap radius of the end
      let bestNode: { p: Vec2; d2: number } | undefined;
      for (const id of graph.nodesNear(E, snapR)) {
        if (graph.degree(id, isStreet) === 0) continue;
        const n = graph.node(id);
        const q = { x: n.x, y: n.y };
        const ql = Math.hypot(q.x - A.x, q.y - A.y);
        if (ql < minLen(cls)) continue;
        const qd = { x: (q.x - A.x) / ql, y: (q.y - A.y) / ql };
        if (qd.x * d.x + qd.y * d.y < Math.cos(params.informalSnapTurn * DEG)) continue;
        if (!clearPath(A, q, skipA)) continue;
        const d2 = (q.x - E.x) ** 2 + (q.y - E.y) ** 2;
        if (!bestNode || d2 < bestNode.d2) bestNode = { p: q, d2 };
      }
      if (bestNode) {
        kind = 'node';
        target = bestNode.p;
      } else {
        // c. street within the snap radius of the end
        const near = graph.nearestEdge(E, snapR, (e) => isStreet(e) && !skipA.has(e.id));
        if (near) {
          const q = { x: near.x, y: near.y };
          const ql = Math.hypot(q.x - A.x, q.y - A.y);
          const qd = ql > 0 ? { x: (q.x - A.x) / ql, y: (q.y - A.y) / ql } : d;
          if (ql >= minLen(cls) && qd.x * d.x + qd.y * d.y >= Math.cos(params.informalSnapTurn * DEG) && clearPath(A, q, skipA)) {
            kind = 'edge';
            target = q;
          }
        }
      }
    }

    // Junction spacing (streets only; alleys come last and are not measured as streets).
    if (cls === 'local' && params.informalJunctionGap > 0) {
      const gap = params.informalJunctionGap;
      // The start becomes a junction when two or more streets already meet there.
      if (majorArmsAt(A) >= 2 && junctionsNear(A, gap).length > 0) return false;
      if ((kind === 'crossing' || kind === 'edge' || kind === 'node') && majorArmsAt(target) >= 2) {
        const j = junctionsNear(target, gap)[0];
        if (j !== undefined) {
          const n = graph.node(j);
          const q = { x: n.x, y: n.y };
          const ql = Math.hypot(q.x - A.x, q.y - A.y);
          const qd = ql > 0 ? { x: (q.x - A.x) / ql, y: (q.y - A.y) / ql } : d;
          if (ql < minLen(cls) || qd.x * d.x + qd.y * d.y < Math.cos(params.informalSnapTurn * DEG) || !clearPath(A, q, skipA)) return false;
          kind = 'node';
          target = q;
          crossedEdge = undefined;
        }
      }
    }

    // 3. region
    const f = allowedUpTo(cls, A, target);
    if (f < 1) {
      kind = 'boundary';
      target = { x: A.x + (target.x - A.x) * f, y: A.y + (target.y - A.y) * f };
    }
    const len = Math.hypot(target.x - A.x, target.y - A.y);
    if (len < minLen(cls)) return false;
    d = { x: (target.x - A.x) / len, y: (target.y - A.y) / len };
    // 2. junction angles (start, and end when it lands on a street)
    if (!angleOk(A, d)) return false;
    const junction = kind === 'crossing' || kind === 'node' || kind === 'edge';
    if (junction && !angleOk(target, { x: -d.x, y: -d.y })) return false;
    if (kind === 'crossing' && crossedEdge) {
      const c = graph.node(crossedEdge.a);
      const e = graph.node(crossedEdge.b);
      const cl = Math.hypot(e.x - c.x, e.y - c.y);
      if (cl > 0 && Math.abs((d.x * (e.y - c.y) - d.y * (e.x - c.x)) / cl) < sinMin) return false;
    }
    // 4. separation
    if (crowded(cls, A, target, skipA, junction)) return false;

    const path = graph.addSegment(A, target, ctx.propsFor(cls));
    if (path.length < 2) return false;
    const endNode = path[path.length - 1] as number;
    const endP = { x: graph.node(endNode).x, y: graph.node(endNode).y };
    if (kind === 'boundary') {
      ctx.connectToFrame(endNode, cls);
      return true;
    }
    const heading = Math.atan2(d.y, d.x);
    const left = prop.left - 1;
    if (kind === 'crossing') {
      if (cls === 'local' && rThrough < params.informalCrossThrough) {
        enqueue({ p: endP, theta: heading, cls, t: prop.t + 1, left, turn: false });
      }
      return true;
    }
    if (kind !== 'free') return true;
    if (left > 0 && rStop >= params.informalStopProbability) {
      enqueue({ p: endP, theta: heading, cls, t: prop.t + 1, left, turn: true, ...(prop.spur ? { spur: true } : {}) });
    }
    const both = rBranch[0] < g.branchProbability && rBranch[1] < g.branchProbability;
    for (const side of [0, 1] as const) {
      if ((rBranch[side] as number) >= g.branchProbability) continue;
      const sign = side === 0 ? 1 : -1;
      // Branches to both sides are staggered (the second leaves mid-segment): two offset T
      // junctions, as in self-built grids, rather than a 4-way crossing at every branch point.
      const at = both && side === 1 ? 0.35 + 0.3 * (rDelay[1] as number) : 1;
      const from = at === 1 ? endP : { x: A.x + (endP.x - A.x) * at, y: A.y + (endP.y - A.y) * at };
      const bcls: GrowClass = cls === 'alley' || (rAlley[side] as number) < g.alleyProbability ? 'alley' : 'local';
      const bt = heading + sign * (90 + ((rBranchTurn[side] as number) * 2 - 1) * params.informalBranchTurn) * DEG;
      const spur = bcls === 'local' && (rSpur[side] as number) < params.informalSpurProbability;
      const segs =
        bcls === 'alley'
          ? 1 + Math.floor((rAlleySegs[side] as number) * params.alleyMaxSegments)
          : spur
            ? 1 + Math.floor((rAlleySegs[side] as number) * params.informalSpurSegments)
            : Infinity;
      const t = prop.t + params.informalBranchDelay * (0.5 + (rDelay[side] as number));
      enqueue({ p: from, theta: bt, cls: bcls, t, left: segs, turn: false, ...(spur ? { spur: true } : {}) });
    }
    return true;
  };

  const drain = (): number => {
    let added = 0;
    for (let prop = queue.pop(); prop; prop = queue.pop()) {
      if (processed++ >= budget) break;
      if (grow(prop)) added++;
    }
    return added;
  };

  // Seeds along the streets already in the district (avenues; formal streets of neighbours never
  // enter it). Both sides, roughly perpendicular, spaced by segment_length.
  const seedRng = ctx.rng.fork('organic:seeds');
  for (const id of graph.edgesInBox(box.minX, box.minY, box.maxX, box.maxY)) {
    const e = graph.edge(id);
    if (!isStreet(e)) continue;
    const a = graph.node(e.a);
    const b = graph.node(e.b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    for (let s = seedRng.range(0.3, 1) * lenMin; s < len - snapTol; s += seedRng.range(lenMin, lenMax)) {
      const p = { x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len };
      for (const sign of [1, -1]) {
        const theta = heading + sign * (90 + seedRng.range(-1, 1) * params.informalBranchTurn) * DEG;
        const probe = { x: p.x + Math.cos(theta) * 10, y: p.y + Math.sin(theta) * 10 };
        if (!ctx.allowed('local', probe)) continue;
        queue.push({ p, theta, cls: 'local', t: seedRng.range(0, 1), left: Infinity, turn: false });
      }
    }
  }

  /** Coverage: proposals from the nearest street towards every allowed point far from all streets. */
  const coverage = (cls: GrowClass, gap: number, t: number): number => {
    const covRng = ctx.rng.fork(`organic:coverage:${cls}:${t}`);
    let pushed = 0;
    const step = gap * 0.75;
    for (let y = box.minY + step * covRng.range(0.25, 0.75); y < box.maxY; y += step) {
      for (let x = box.minX + step * covRng.range(0.25, 0.75); x < box.maxX; x += step) {
        const p = { x, y };
        if (!ctx.allowed(cls, p)) continue;
        if (graph.nearestEdge(p, gap, isStreet)) continue;
        const from = graph.nearestEdge(p, gap * 4, inDistrictStreet);
        if (!from) continue;
        const q = { x: from.x, y: from.y };
        const e = graph.edge(from.edge);
        const a = graph.node(e.a);
        const b = graph.node(e.b);
        // Head away from the street, perpendicular to it, on p's side.
        let nx = -(b.y - a.y);
        let ny = b.x - a.x;
        if (nx * (p.x - q.x) + ny * (p.y - q.y) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const theta = Math.atan2(ny, nx) + covRng.range(-1, 1) * params.informalBranchTurn * DEG;
        queue.push({ p: q, theta, cls, t, left: cls === 'alley' ? params.alleyMaxSegments : Infinity, turn: false });
        pushed++;
        if (drain() === 0) continue;
      }
    }
    return pushed;
  };

  drain();
  for (let i = 0; i < params.informalCoveragePasses; i++) {
    if (coverage('local', params.informalCoverageGap, 1000 * (i + 1)) === 0) break;
  }

  /** Straight local street p→q across a face (both ends on streets), if every constraint holds. */
  const cut = (p0: Vec2, q0: Vec2): boolean => {
    // Each end: moved onto a junction within informalJunctionGap (no sliver between two
    // junctions), or kept as is when no junction is within half that gap.
    const gap = params.informalJunctionGap;
    const options = (x: Vec2): Vec2[] => {
      if (gap <= 0) return [x];
      const out: Vec2[] = [];
      const j = junctionsNear(x, gap)[0];
      if (j !== undefined) out.push({ x: graph.node(j).x, y: graph.node(j).y });
      if (junctionsNear(x, gap / 2).length === 0) out.push(x);
      return out;
    };
    for (const p of options(p0)) for (const q of options(q0)) if (cutStraight(p, q)) return true;
    return false;
  };
  const cutStraight = (p: Vec2, q: Vec2): boolean => {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < minLen('local')) return false;
    const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    if (allowedUpTo('local', p, q) < 1) return false;
    if (!angleOk(p, d) || !angleOk(q, { x: -d.x, y: -d.y })) return false;
    const skip = touching(p);
    for (const id of touching(q)) skip.add(id);
    for (const id of graph.edgesInBox(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y))) {
      if (skip.has(id)) continue;
      const e = graph.edge(id);
      if (!isStreet(e)) continue;
      const a = graph.node(e.a);
      const b = graph.node(e.b);
      if (!segmentIntersection(p, q, a, b)) continue;
      const el = Math.hypot(b.x - a.x, b.y - a.y);
      if (el === 0 || Math.abs((d.x * (b.y - a.y) - d.y * (b.x - a.x)) / el) < sinMin) return false;
    }
    if (crowded('local', p, q, skip, true)) return false;
    return graph.addSegment(p, q, ctx.propsFor('local')).length >= 2;
  };

  /**
   * Infill: every face of the grown network inside the district larger than informalInfillArea
   * gets a cross street (see `cut`), so long strips between parallel streets get cross streets.
   */
  const infill = (t: number): number => {
    const snap = graph.snapshot();
    const { bounded } = extractFaces(snap);
    let pushed = 0;
    for (const f of bounded) {
      if (f.area <= params.informalInfillArea) continue;
      const ring = f.ring;
      let cx = 0;
      let cy = 0;
      let a2 = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const p = ring[j] as Vec2;
        const q = ring[i] as Vec2;
        const c = p.x * q.y - q.x * p.y;
        a2 += c;
        cx += (p.x + q.x) * c;
        cy += (p.y + q.y) * c;
      }
      if (a2 === 0) continue;
      const c = { x: cx / (3 * a2), y: cy / (3 * a2) };
      if (!region.contains(c)) continue;
      // Long axis from the second moments of the ring vertices.
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const p of ring) {
        sxx += (p.x - c.x) ** 2;
        syy += (p.y - c.y) ** 2;
        sxy += (p.x - c.x) * (p.y - c.y);
      }
      const major = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const u = { x: Math.cos(major), y: Math.sin(major) };
      const v = { x: -u.y, y: u.x };
      let halfLen = 0;
      for (const p of ring) halfLen = Math.max(halfLen, Math.abs((p.x - c.x) * u.x + (p.y - c.y) * u.y));
      // Candidate cuts across the long axis (centre, then ±20%, ±35%): a straight street between the
      // two sides of the face (both must be streets), crossing any dead end inside it.
      let done = false;
      for (const off of INFILL_OFFSETS) {
        const o = { x: c.x + u.x * off * 2 * halfLen, y: c.y + u.y * off * 2 * halfLen };
        if (!region.contains(o)) continue;
        const ends: Vec2[] = [];
        for (const sign of [1, -1]) {
          const far = { x: o.x + sign * v.x * 1e4, y: o.y + sign * v.y * 1e4 };
          let best: { p: Vec2; t: number } | undefined;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const hit = segmentIntersection(o, far, ring[j] as Vec2, ring[i] as Vec2);
            if (hit && (!best || hit.t < best.t)) best = { p: { x: o.x + (far.x - o.x) * hit.t, y: o.y + (far.y - o.y) * hit.t }, t: hit.t };
          }
          if (best && graph.nearestEdge(best.p, snapTol, inDistrictStreet)) ends.push(best.p);
        }
        if (ends.length === 2 && cut(ends[0] as Vec2, ends[1] as Vec2)) {
          done = true;
          break;
        }
      }
      // Fallback: grow a street into the face from its nearest street side (may end on a dead end).
      for (const off of done ? [] : [0, -0.25, 0.25]) {
        const o = { x: c.x + u.x * off * 2 * halfLen, y: c.y + u.y * off * 2 * halfLen };
        if (!region.contains(o)) continue;
        const starts: { p: Vec2; d: number; theta: number }[] = [];
        for (const sign of [1, -1]) {
          const far = { x: o.x + sign * v.x * 1e4, y: o.y + sign * v.y * 1e4 };
          let best: { p: Vec2; d: number } | undefined;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const hit = segmentIntersection(o, far, ring[j] as Vec2, ring[i] as Vec2);
            if (hit && (!best || hit.t * 1e4 < best.d)) best = { p: { x: o.x + (far.x - o.x) * hit.t, y: o.y + (far.y - o.y) * hit.t }, d: hit.t * 1e4 };
          }
          if (best && graph.nearestEdge(best.p, snapTol, inDistrictStreet)) starts.push({ ...best, theta: Math.atan2(-sign * v.y, -sign * v.x) });
        }
        starts.sort((a, b) => a.d - b.d);
        for (const st of starts) {
          if (grow({ p: st.p, theta: st.theta, cls: 'local', t, left: 2, turn: false })) {
            done = true;
            break;
          }
        }
        if (done) break;
      }
      if (done) pushed++;
    }
    if (pushed > 0) drain();
    return pushed;
  };
  if (params.informalInfillArea > 0) {
    for (let i = 0; i < params.informalInfillPasses; i++) if (infill(2000 * (i + 1)) === 0) break;
  }

  // Alleys: grown last, in the finished street network.
  phase = 'alleys';
  rng = ctx.rng.fork('organic:alleys');
  for (const a of alleys) queue.push(a);
  drain();
};
