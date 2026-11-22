/**
 * Seeded noise functions for the procedural map. Integer-hash gradient noise (same hash and gradient
 * table as terrain.ts), so every value is a pure function of (x, y, seed): no Math.random anywhere.
 *
 * - fbm: fractal Brownian motion, normalised to roughly [-1, 1].
 * - ridged: Musgrave ridged multifractal, roughly [0, 1]; sharp crests, rounded valleys.
 * - warp: Quilez domain warping, p -> p + strength * (fbm, fbm); breaks the blob look of plain noise.
 */

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x1b873593) ^ Math.imul(iy | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const GRAD_COS = new Float64Array(256);
const GRAD_SIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  GRAD_COS[i] = Math.cos((i / 256) * Math.PI * 2);
  GRAD_SIN[i] = Math.sin((i / 256) * Math.PI * 2);
}

/** Perlin gradient noise, roughly in [-0.7, 0.7]. */
export function perlin(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const g = (cx: number, cy: number, dx: number, dy: number): number => {
    const k = (hash2(cx, cy, seed) * 256) | 0;
    return GRAD_COS[k]! * dx + GRAD_SIN[k]! * dy;
  };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = g(ix, iy, fx, fy);
  const n10 = g(ix + 1, iy, fx - 1, fy);
  const n01 = g(ix, iy + 1, fx, fy - 1);
  const n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const top = n00 + u * (n10 - n00);
  const bottom = n01 + u * (n11 - n01);
  return top + v * (bottom - top);
}

export interface Octaves {
  /** Wavelength of the first octave, metres. */
  readonly wavelength: number;
  readonly octaves: number;
  /** Amplitude ratio between octaves (persistence / gain). */
  readonly gain?: number;
  /** Frequency ratio between octaves; 2.03 instead of 2 avoids octave alignment. */
  readonly lacunarity?: number;
}

/** fBm normalised so the result is roughly in [-1, 1]. */
export function fbm(x: number, y: number, o: Octaves, seed: number): number {
  const gain = o.gain ?? 0.5;
  const lac = o.lacunarity ?? 2.03;
  let f = 1 / o.wavelength;
  let a = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    sum += a * perlin(x * f + i * 17.31, y * f - i * 9.77, seed + i * 131);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return (sum / norm) * 1.6;
}

/**
 * Ridged multifractal (Musgrave): signal = (offset - |n|)^2, each octave weighted by the previous
 * signal so detail gathers on the crests. Roughly in [0, 1].
 */
export function ridged(x: number, y: number, o: Octaves, seed: number, offset = 1, ridgeGain = 2): number {
  const lac = o.lacunarity ?? 2.03;
  const gain = o.gain ?? 0.5;
  let f = 1 / o.wavelength;
  let weight = 1;
  let a = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    let s = offset - Math.abs(perlin(x * f + i * 23.1, y * f + i * 5.3, seed + 7 + i * 173) * 1.45);
    s *= s;
    s *= weight;
    weight = Math.min(1, Math.max(0, s * ridgeGain));
    sum += s * a;
    norm += a;
    a *= gain;
    f *= lac;
  }
  return sum / norm;
}

/** Domain warp: returns the displaced point p + strength * (fbm_a(p), fbm_b(p)). */
export function warp(x: number, y: number, o: Octaves, strength: number, seed: number): [number, number] {
  const qx = fbm(x, y, o, seed + 1001);
  const qy = fbm(x + 5200, y + 1300, o, seed + 2003);
  return [x + strength * qx, y + strength * qy];
}

/** Stretches space along `angleRad` by `ratio` (> 1 gives features elongated along that direction). */
export function anisotropic(x: number, y: number, angleRad: number, ratio: number): [number, number] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const u = x * c + y * s;
  const v = -x * s + y * c;
  return [u / ratio, v];
}

/** Per-cell hash in [0, 1), for jitter. */
export function hash01(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
