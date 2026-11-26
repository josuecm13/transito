/**
 * Smooth outline of a section region. The district grid is an area budget with stair-stepped edges
 * (spec.grid); the boundary road of a section follows the SMOOTH shape of that region instead:
 * rasterise the region, blur it by `smoothing` (the grid cell: the size of one stair step), take the
 * 0.5 contour of the largest blob (small holes fill, detached cells drop) and simplify it so that no
 * side deviates from its chord by more than `irregularity` x chord (the measured block-side
 * irregularity) nor exceeds `maxChord` (the measured p90 segment length).
 */
import type { Vec2 } from '../../vec.ts';
import type { Rect } from '../../geometry.ts';
import * as D from './dmath.ts';

/** Raster resolution (m) of the region mask: an implementation detail, far below any street feature. */
export const RASTER_STEP = 10;

export interface OutlineOptions {
  /** Is p inside the region (district cells, playable land, active area)? */
  inside: (p: Vec2) => boolean;
  /** Box containing the whole region. */
  box: Rect;
  /** Blur sigma (m). */
  smoothing: number;
  irregularity: number;
  maxChord: number;
}

export const ringAreaSigned = (r: readonly Vec2[]): number => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j] as Vec2).x * (r[i] as Vec2).y - (r[i] as Vec2).x * (r[j] as Vec2).y;
  return s / 2;
};

function blur(src: Float64Array, w: number, h: number, sigmaPx: number): Float64Array {
  const rad = Math.max(1, Math.ceil(3 * sigmaPx));
  const k: number[] = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) {
    const v = D.exp(-(i * i) / (2 * sigmaPx * sigmaPx));
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] = (k[i] as number) / sum;
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let d = -rad; d <= rad; d++) {
        const x = i + d;
        if (x >= 0 && x < w) s += (src[j * w + x] as number) * (k[d + rad] as number);
      }
      tmp[j * w + i] = s;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let d = -rad; d <= rad; d++) {
        const y = j + d;
        if (y >= 0 && y < h) s += (tmp[y * w + i] as number) * (k[d + rad] as number);
      }
      out[j * w + i] = s;
    }
  }
  return out;
}

/** Closed 0.5-contours of a scalar grid (marching squares), each as a ring of points in grid units. */
function contours(f: Float64Array, w: number, h: number, level: number): Vec2[][] {
  type Seg = { a: string; b: string; pa: Vec2; pb: Vec2 };
  const segs: Seg[] = [];
  const at = (i: number, j: number): number => f[j * w + i] as number;
  const edgePt = (i0: number, j0: number, i1: number, j1: number): { key: string; p: Vec2 } => {
    const v0 = at(i0, j0);
    const v1 = at(i1, j1);
    const t = (level - v0) / (v1 - v0);
    return { key: `${i0},${j0}-${i1},${j1}`, p: { x: i0 + (i1 - i0) * t, y: j0 + (j1 - j0) * t } };
  };
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const c = (v[0]! >= level ? 1 : 0) | (v[1]! >= level ? 2 : 0) | (v[2]! >= level ? 4 : 0) | (v[3]! >= level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const E = {
        s: () => edgePt(i, j, i + 1, j),
        e: () => edgePt(i + 1, j, i + 1, j + 1),
        n: () => edgePt(i, j + 1, i + 1, j + 1),
        w: () => edgePt(i, j, i, j + 1),
      };
      const pairs: [keyof typeof E, keyof typeof E][] = [];
      switch (c) {
        case 1: case 14: pairs.push(['w', 's']); break;
        case 2: case 13: pairs.push(['s', 'e']); break;
        case 3: case 12: pairs.push(['w', 'e']); break;
        case 4: case 11: pairs.push(['e', 'n']); break;
        case 6: case 9: pairs.push(['s', 'n']); break;
        case 7: case 8: pairs.push(['w', 'n']); break;
        case 5: case 10: {
          const centre = (v[0]! + v[1]! + v[2]! + v[3]!) / 4 >= level;
          if ((c === 5) === centre) pairs.push(['w', 'n'], ['s', 'e']);
          else pairs.push(['w', 's'], ['e', 'n']);
          break;
        }
      }
      for (const [p, q] of pairs) {
        const a = E[p]();
        const b = E[q]();
        segs.push({ a: a.key, b: b.key, pa: a.p, pb: b.p });
      }
    }
  }
  const byKey = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [s.a, s.b]) {
      const l = byKey.get(k);
      if (l) l.push(i);
      else byKey.set(k, [i]);
    }
  });
  const used = new Array<boolean>(segs.length).fill(false);
  const rings: Vec2[][] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = true;
    const ring: Vec2[] = [segs[s0]!.pa];
    let key = segs[s0]!.b;
    let pt = segs[s0]!.pb;
    for (let guard = 0; guard < segs.length + 2; guard++) {
      ring.push(pt);
      if (key === segs[s0]!.a) break;
      const next = (byKey.get(key) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = true;
      const s = segs[next]!;
      if (s.a === key) {
        key = s.b;
        pt = s.pb;
      } else {
        key = s.a;
        pt = s.pa;
      }
    }
    ring.pop();
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Douglas-Peucker on a closed ring with a deviation limit relative to the chord, plus a chord cap. */
function simplifyRelative(ring: readonly Vec2[], rel: number, maxChord: number): Vec2[] {
  const n = ring.length;
  const keep = new Array<boolean>(n).fill(false);
  let far = 0;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot((ring[i] as Vec2).x - (ring[0] as Vec2).x, (ring[i] as Vec2).y - (ring[0] as Vec2).y);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  keep[0] = true;
  keep[far] = true;
  const rec = (i0: number, i1: number): void => {
    // ring[i0] .. ring[i1] with i1 possibly wrapping past n (i1 > i0)
    const a = ring[i0 % n] as Vec2;
    const b = ring[i1 % n] as Vec2;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    let worst = -1;
    let wd = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = ring[i % n] as Vec2;
      const d = chord === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / chord;
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst < 0) return;
    if (wd > rel * chord || chord > maxChord) {
      keep[worst % n] = true;
      rec(i0, worst);
      rec(worst, i1);
    }
  };
  rec(0, far);
  rec(far, n);
  return ring.filter((_, i) => keep[i]);
}

/** Largest closed contour of the smoothed region as a counter-clockwise ring (world metres), or undefined. */
export function buildOutline(o: OutlineOptions): Vec2[] | undefined {
  const h = RASTER_STEP;
  const pad = Math.ceil(3 * o.smoothing + 2 * h);
  const x0 = o.box.minX - pad;
  const y0 = o.box.minY - pad;
  const w = Math.ceil((o.box.maxX - o.box.minX + 2 * pad) / h) + 1;
  const ht = Math.ceil((o.box.maxY - o.box.minY + 2 * pad) / h) + 1;
  const m = new Float64Array(w * ht);
  for (let j = 0; j < ht; j++) for (let i = 0; i < w; i++) m[j * w + i] = o.inside({ x: x0 + i * h, y: y0 + j * h }) ? 1 : 0;
  const f = blur(m, w, ht, o.smoothing / h);
  let best: Vec2[] | undefined;
  let bestA = 0;
  for (const r of contours(f, w, ht, 0.5)) {
    const world = r.map((p) => ({ x: x0 + p.x * h, y: y0 + p.y * h }));
    const a = Math.abs(ringAreaSigned(world));
    if (a > bestA) {
      bestA = a;
      best = world;
    }
  }
  if (!best) return undefined;
  let ring = simplifyRelative(best, o.irregularity, o.maxChord);
  if (ringAreaSigned(ring) < 0) ring = ring.reverse();
  return ring;
}
