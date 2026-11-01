/**
 * Streamline tracing on a tensor field (issue #7, S3).
 *
 * A streamline follows the major or minor eigenvector of the field with RK4 steps, from a seed in
 * both directions, until it:
 *   - boundary:    would leave the allowed region (land, district, clearance from frames); the
 *                  end is refined by bisection to within 0.25 m of the limit,
 *   - separation:  comes within `dtest` of an existing street running parallel to it
 *                  (|cos| > cos(parallelAngle)); crossing streets never stop it,
 *   - degenerate:  the field has no reliable direction, or turns too sharply in one step,
 *   - loop:        comes back near its own earlier part,
 *   - length:      reaches maxLength.
 * Seeds for evenly spaced streamlines come from points at ±dsep beside existing streets
 * (Jobard & Lefer), plus a coverage scan; see `generate.ts`.
 */
import type { Vec2 } from '../vec.ts';
import type { TensorField } from './tensor-field.ts';

export type Family = 'major' | 'minor';
export type EndReason = 'boundary' | 'separation' | 'degenerate' | 'loop' | 'length';

/** Street samples (point + unit tangent) for separation tests. */
export class SampleIndex {
  private readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly tx: number[] = [];
  private readonly ty: number[] = [];

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(ix: number, iy: number): number {
    return (ix + 0x8000) * 0x10000 + (iy + 0x8000);
  }

  add(p: Vec2, t: Vec2): void {
    const id = this.xs.length;
    this.xs.push(p.x);
    this.ys.push(p.y);
    this.tx.push(t.x);
    this.ty.push(t.y);
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    const l = this.cells.get(k);
    if (l) l.push(id);
    else this.cells.set(k, [id]);
  }

  /** Samples a polyline every `step` m (and its vertices) with its tangent. */
  addPolyline(pts: readonly Vec2[], step: number): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as Vec2;
      const b = pts[i + 1] as Vec2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) this.add({ x: a.x + (b.x - a.x) * (k / n), y: a.y + (b.y - a.y) * (k / n) }, t);
      if (i === pts.length - 2) this.add(b, t);
    }
  }

  /**
   * Is there a sample within r of p whose tangent is within the parallel cone of dir? With
   * `visible`, only samples q for which visible(q) holds count (e.g. not behind a crossing street).
   */
  hasParallel(p: Vec2, dir: Vec2, r: number, cosParallel: number, visible?: (q: Vec2) => boolean): boolean {
    const c = this.cell;
    const r2 = r * r;
    for (let ix = Math.floor((p.x - r) / c); ix <= Math.floor((p.x + r) / c); ix++) {
      for (let iy = Math.floor((p.y - r) / c); iy <= Math.floor((p.y + r) / c); iy++) {
        const l = this.cells.get(this.key(ix, iy));
        if (!l) continue;
        for (const id of l) {
          const dx = (this.xs[id] as number) - p.x;
          const dy = (this.ys[id] as number) - p.y;
          if (dx * dx + dy * dy > r2) continue;
          if (Math.abs((this.tx[id] as number) * dir.x + (this.ty[id] as number) * dir.y) < cosParallel) continue;
          if (!visible || visible({ x: this.xs[id] as number, y: this.ys[id] as number })) return true;
        }
      }
    }
    return false;
  }
}

export interface TraceOptions {
  step: number;
  maxLength: number;
  /** Separation distance for the stop test. */
  dtest: number;
  /** cos of the angle under which another street counts as parallel. */
  cosParallel: number;
  /** Largest direction change allowed in one step (radians). */
  maxTurn: number;
  allowed(p: Vec2): boolean;
  samples: SampleIndex;
  /** Optional visibility filter for the separation test (see SampleIndex.hasParallel). */
  visible?: (from: Vec2, to: Vec2) => boolean;
}

export interface Trace {
  points: Vec2[];
  /** Index of the seed in points. */
  seedIndex: number;
  /** Why each end stopped: [start, end]. */
  ends: [EndReason, EndReason];
}

function aligned(v: Vec2 | undefined, ref: Vec2): Vec2 | undefined {
  if (!v) return undefined;
  return v.x * ref.x + v.y * ref.y < 0 ? { x: -v.x, y: -v.y } : v;
}

function traceHalf(field: TensorField, seed: Vec2, family: Family, dir0: Vec2, o: TraceOptions): { pts: Vec2[]; end: EndReason } {
  const pts: Vec2[] = [];
  let p = seed;
  let d = dir0;
  let len = 0;
  const h = o.step;
  const loopSkip = Math.ceil((3 * o.dtest) / h) + 2;
  for (;;) {
    if (len >= o.maxLength) return { pts, end: 'length' };
    const k1 = aligned(field.direction(p, family), d);
    if (!k1) return { pts, end: 'degenerate' };
    const k2 = aligned(field.direction({ x: p.x + (k1.x * h) / 2, y: p.y + (k1.y * h) / 2 }, family), k1);
    const k3 = k2 && aligned(field.direction({ x: p.x + (k2.x * h) / 2, y: p.y + (k2.y * h) / 2 }, family), k1);
    const k4 = k3 && aligned(field.direction({ x: p.x + k3.x * h, y: p.y + k3.y * h }, family), k1);
    if (!k2 || !k3 || !k4) return { pts, end: 'degenerate' };
    let sx = k1.x + 2 * k2.x + 2 * k3.x + k4.x;
    let sy = k1.y + 2 * k2.y + 2 * k3.y + k4.y;
    const sl = Math.hypot(sx, sy);
    if (sl === 0) return { pts, end: 'degenerate' };
    sx /= sl;
    sy /= sl;
    if (Math.acos(Math.max(-1, Math.min(1, sx * d.x + sy * d.y))) > o.maxTurn) return { pts, end: 'degenerate' };
    const q = { x: p.x + sx * h, y: p.y + sy * h };
    const nd = { x: sx, y: sy };
    if (!o.allowed(q)) {
      // Bisect towards the limit so the end sits within 0.25 m of it.
      let lo = 0;
      let hi = h;
      while (hi - lo > 0.25) {
        const m = (lo + hi) / 2;
        if (o.allowed({ x: p.x + sx * m, y: p.y + sy * m })) lo = m;
        else hi = m;
      }
      if (lo > 0.05) pts.push({ x: p.x + sx * lo, y: p.y + sy * lo });
      return { pts, end: 'boundary' };
    }
    const vis = o.visible;
    if (o.samples.hasParallel(q, nd, o.dtest, o.cosParallel, vis && ((r) => vis(q, r)))) return { pts, end: 'separation' };
    // Loop: back near an earlier part of itself.
    for (let i = 0; i < pts.length - loopSkip; i++) {
      const r = pts[i] as Vec2;
      if ((r.x - q.x) ** 2 + (r.y - q.y) ** 2 < o.dtest * o.dtest) return { pts, end: 'loop' };
    }
    pts.push(q);
    p = q;
    d = nd;
    len += h;
  }
}

/** Traces a streamline through `seed` in both directions. Undefined if the seed has no direction. */
export function traceStreamline(field: TensorField, seed: Vec2, family: Family, o: TraceOptions): Trace | undefined {
  const d = field.direction(seed, family);
  if (!d) return undefined;
  const fwd = traceHalf(field, seed, family, d, o);
  const bwd = traceHalf(field, seed, family, { x: -d.x, y: -d.y }, o);
  const points = [...bwd.pts.reverse(), seed, ...fwd.pts];
  return { points, seedIndex: bwd.pts.length, ends: [bwd.end, fwd.end] };
}

/** Douglas–Peucker simplification (keeps both ends). */
export function simplify(pts: readonly Vec2[], tol: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number];
    const a = pts[i] as Vec2;
    const b = pts[j] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let fd = 0;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k] as Vec2;
      const d = len === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
      if (d > fd) {
        fd = d;
        far = k;
      }
    }
    if (far >= 0 && fd > tol) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Drops interior vertices closer than `minGap` to the previous kept vertex (ends always kept). */
export function enforceVertexGap(pts: readonly Vec2[], minGap: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vec2[] = [pts[0] as Vec2];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i] as Vec2;
    const l = out[out.length - 1] as Vec2;
    if (Math.hypot(p.x - l.x, p.y - l.y) >= minGap) out.push(p);
  }
  const last = pts[pts.length - 1] as Vec2;
  while (out.length > 1 && Math.hypot(last.x - out[out.length - 1]!.x, last.y - out[out.length - 1]!.y) < minGap) out.pop();
  out.push(last);
  return out;
}

/** Arc length at every vertex. */
export function arcLengths(pts: readonly Vec2[]): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push((s[i - 1] as number) + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return s;
}

/** Sub-polyline between arc lengths s0 < s1. */
export function slicePolyline(pts: readonly Vec2[], s0: number, s1: number): Vec2[] {
  const s = arcLengths(pts);
  const at = (target: number): Vec2 => {
    for (let i = 1; i < pts.length; i++) {
      if ((s[i] as number) >= target) {
        const a = pts[i - 1] as Vec2;
        const b = pts[i] as Vec2;
        const seg = (s[i] as number) - (s[i - 1] as number);
        const t = seg === 0 ? 0 : (target - (s[i - 1] as number)) / seg;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return pts[pts.length - 1] as Vec2;
  };
  const out: Vec2[] = [at(s0)];
  for (let i = 0; i < pts.length; i++) if ((s[i] as number) > s0 && (s[i] as number) < s1) out.push(pts[i] as Vec2);
  out.push(at(s1));
  return out;
}
