/**
 * 2D tensor field for formal street layouts (issue #7, S3; after Chen et al. 2008).
 *
 * A tensor is stored as (a, b) = r · (cos 2θ, sin 2θ): a symmetric traceless 2×2 matrix whose
 * major eigenvector points at angle θ and minor eigenvector at θ + 90°. Streets follow the major
 * (one family) or the minor (the crossing family) eigenvector. Doubling the angle makes θ and
 * θ + 180° the same tensor, so directions blend without sign problems.
 *
 * Basis elements (summed with weights):
 *   - grid:     constant direction θ = angle. No anchor, so `decay` does not apply (uniform).
 *   - radial:   major eigenvector tangent to circles around `at` (rings), minor along spokes.
 *               weight · exp(-(d/decay)²), d = distance to `at`.
 *   - polyline: aligned with the nearest segments of a polyline (coastline, avenues).
 *               weight · exp(-(d/decay)²), d = distance to the polyline; the direction blends the
 *               segments within reach by the same falloff, so corners turn smoothly.
 * An element without decay has uniform weight.
 *
 * Alignment rule (`alignSegments`): a line basis next to a background field that runs at ~90° to
 * it would cancel it on a band beside the line (a degenerate band where streets stop). So each
 * segment of a line basis is oriented to REINFORCE the background: it is aligned with whichever
 * eigenvector (major or minor) of the background is closer to it. The line is still parallel to
 * one street family and perpendicular to the other; the field rotates by at most 45° near it.
 */
import type { Vec2 } from '../vec.ts';

export interface Tensor {
  a: number;
  b: number;
}

export type Basis =
  | { kind: 'grid'; theta: number; weight: number }
  | { kind: 'radial'; center: Vec2; weight: number; decay?: number }
  | {
      kind: 'polyline';
      segments: [Vec2, Vec2][];
      weight: number;
      decay?: number;
      /** Per segment: true = the segment is aligned with the MINOR eigenvector (θ + 90°). */
      flips?: boolean[];
    };

export interface TensorField {
  tensor(p: Vec2): Tensor;
  /** Unit eigenvector (major or minor) at p, or undefined at a degenerate point. */
  direction(p: Vec2, family: 'major' | 'minor'): Vec2 | undefined;
}

/** Below this tensor magnitude the field is degenerate (no reliable direction). */
export const DEGENERATE = 1e-3;

function falloff(d: number, decay: number | undefined): number {
  return decay === undefined ? 1 : Math.exp(-((d / decay) ** 2));
}

function segDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

export function basisTensor(el: Basis, p: Vec2): Tensor {
  switch (el.kind) {
    case 'grid':
      return { a: el.weight * Math.cos(2 * el.theta), b: el.weight * Math.sin(2 * el.theta) };
    case 'radial': {
      const dx = p.x - el.center.x;
      const dy = p.y - el.center.y;
      const d = Math.hypot(dx, dy);
      if (d === 0) return { a: 0, b: 0 };
      const theta = Math.atan2(dy, dx) + Math.PI / 2;
      const w = el.weight * falloff(d, el.decay);
      return { a: w * Math.cos(2 * theta), b: w * Math.sin(2 * theta) };
    }
    case 'polyline': {
      let dmin = Infinity;
      let sa = 0;
      let sb = 0;
      const reach = el.decay === undefined ? Infinity : el.decay * 3;
      for (let i = 0; i < el.segments.length; i++) {
        const [a, b] = el.segments[i] as [Vec2, Vec2];
        const d = segDistance(p, a, b);
        if (d < dmin) dmin = d;
        if (d > reach) continue;
        const theta = Math.atan2(b.y - a.y, b.x - a.x) + (el.flips?.[i] ? Math.PI / 2 : 0);
        const w = el.decay === undefined ? 1 / (1 + d) : falloff(d, el.decay);
        sa += w * Math.cos(2 * theta);
        sb += w * Math.sin(2 * theta);
      }
      const r = Math.hypot(sa, sb);
      if (r === 0 || !Number.isFinite(dmin)) return { a: 0, b: 0 };
      const w = el.weight * falloff(dmin, el.decay);
      return { a: (w * sa) / r, b: (w * sb) / r };
    }
  }
}

/** Exact field: sum of the basis tensors at p. */
export function createTensorField(elements: readonly Basis[]): TensorField {
  const tensor = (p: Vec2): Tensor => {
    let a = 0;
    let b = 0;
    for (const el of elements) {
      const t = basisTensor(el, p);
      a += t.a;
      b += t.b;
    }
    return { a, b };
  };
  return { tensor, direction: (p, family) => eigenvector(tensor(p), family) };
}

export function eigenvector(t: Tensor, family: 'major' | 'minor'): Vec2 | undefined {
  if (Math.hypot(t.a, t.b) < DEGENERATE) return undefined;
  const theta = Math.atan2(t.b, t.a) / 2 + (family === 'minor' ? Math.PI / 2 : 0);
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

/**
 * The same field sampled on a regular grid over `box` (cell `cell` m) and bilinearly
 * interpolated: tracing evaluates the field thousands of times, the samples are computed once.
 * Outside the box the nearest border sample is used.
 */
export function sampleTensorField(
  field: TensorField,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  cell: number,
): TensorField {
  const nx = Math.max(2, Math.ceil((box.maxX - box.minX) / cell) + 1);
  const ny = Math.max(2, Math.ceil((box.maxY - box.minY) / cell) + 1);
  const A = new Float64Array(nx * ny);
  const B = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const t = field.tensor({ x: box.minX + i * cell, y: box.minY + j * cell });
      A[j * nx + i] = t.a;
      B[j * nx + i] = t.b;
    }
  }
  const tensor = (p: Vec2): Tensor => {
    const fx = Math.max(0, Math.min(nx - 1 - 1e-9, (p.x - box.minX) / cell));
    const fy = Math.max(0, Math.min(ny - 1 - 1e-9, (p.y - box.minY) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const k = j * nx + i;
    const lerp2 = (M: Float64Array) =>
      (M[k] as number) * (1 - u) * (1 - v) +
      (M[k + 1] as number) * u * (1 - v) +
      (M[k + nx] as number) * (1 - u) * v +
      (M[k + nx + 1] as number) * u * v;
    return { a: lerp2(A), b: lerp2(B) };
  };
  return { tensor, direction: (p, family) => eigenvector(tensor(p), family) };
}

/**
 * For each segment, whether it should align with the background's MINOR eigenvector (see the
 * alignment rule above): true when the segment's doubled-angle tensor opposes the background
 * tensor at the segment midpoint.
 */
export function alignSegments(segments: readonly [Vec2, Vec2][], background: TensorField | undefined): boolean[] {
  return segments.map(([a, b]) => {
    if (!background) return false;
    const t = background.tensor({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const theta = Math.atan2(b.y - a.y, b.x - a.x);
    return t.a * Math.cos(2 * theta) + t.b * Math.sin(2 * theta) < 0;
  });
}
