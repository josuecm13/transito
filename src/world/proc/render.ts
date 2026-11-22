/**
 * Cartographic render of the procedural map to an RGB buffer (top row = north).
 *
 * Relief shading: multidirectional oblique hillshade (Mark 1992) on a height upsampled to pixel size
 * with fine fractal detail, times a valley-darkening term (height minus its blur, a cheap sky-view
 * proxy). Colour comes from the layers (sea depth, lake, cover, urban density); rivers, roads and
 * runways are drawn as anti-aliased strokes. Pure: same layers, same pixels.
 */
import type { Vec2 } from '../vec.ts';
import { blur, sample, type FieldGrid, type MaskGrid } from './grid.ts';
import { fbm, hash01 } from './noise.ts';

export interface Stroke {
  readonly points: readonly Vec2[];
  /** Width in metres. */
  readonly width: number;
  readonly color: readonly [number, number, number];
  /** Optional darker casing width in metres (drawn first). */
  readonly casing?: number;
  readonly casingColor?: readonly [number, number, number];
  /** Dash pattern [on, off] in metres for the main stroke (casing stays solid). */
  readonly dash?: readonly [number, number];
}

export interface Dot {
  readonly at: Vec2;
  /** Outer radius in metres. */
  readonly radius: number;
  readonly fill: readonly [number, number, number];
  readonly ring: readonly [number, number, number];
  /** Ring thickness in metres. */
  readonly ringWidth: number;
  /** Optional inner dot (interchange style). */
  readonly core?: { readonly radius: number; readonly color: readonly [number, number, number] };
}

export interface RenderInput {
  readonly height: FieldGrid;
  readonly land: MaskGrid;
  /** Signed distance to shore (m, + on land); when given, the coast is drawn from it (smooth). */
  readonly shore?: FieldGrid;
  /** Cover class per cell (see COVER_*), optional. */
  readonly cover?: Uint8Array;
  readonly lake?: MaskGrid;
  readonly lakeLevel?: number;
  /** Urban density 0..1 per cell. */
  readonly urban?: FieldGrid;
  /** Drawn in order (rivers first, then roads...). */
  readonly strokes?: readonly Stroke[];
  /** Filled polygons drawn after cover, before strokes (airport aprons, lock chambers). */
  readonly fills?: readonly { readonly ring: readonly Vec2[]; readonly color: readonly [number, number, number] }[];
  /** Drawn last (stations). */
  readonly dots?: readonly Dot[];
}

export const COVER_FOREST = 0;
export const COVER_HIGH_FOREST = 1;
export const COVER_CLEARING = 2;
export const COVER_MANGROVE = 3;
export const COVER_BEACH = 4;
export const COVER_PAVED = 5;

type RGB = [number, number, number];
const mix = (a: readonly number[], b: readonly number[], t: number): RGB => [
  a[0]! + (b[0]! - a[0]!) * t,
  a[1]! + (b[1]! - a[1]!) * t,
  a[2]! + (b[2]! - a[2]!) * t,
];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const SEA_DEEP: RGB = [16, 50, 96];
const SEA_SHALLOW: RGB = [46, 118, 160];
const SEA_SHORE: RGB = [96, 170, 182];
const LAKE_DEEP: RGB = [42, 104, 152];
const LAKE_SHORE: RGB = [86, 156, 176];
const FOREST: RGB = [40, 98, 38];
const HIGH_FOREST: RGB = [26, 74, 32];
const CLEARING: RGB = [128, 158, 64];
const MANGROVE: RGB = [44, 88, 52];
const BEACH: RGB = [214, 202, 150];
const PAVED: RGB = [150, 146, 138];
const URBAN_LOW: RGB = [168, 156, 136];
const URBAN_HIGH: RGB = [128, 124, 122];

export interface RenderOptions {
  /** Metres per output pixel. */
  readonly metresPerPixel: number;
  /** Vertical exaggeration of the shading. */
  readonly exaggeration: number;
  readonly seed: number;
}

export function renderMap(input: RenderInput, o: RenderOptions): { width: number; height: number; rgb: Uint8Array } {
  const g = input.height;
  const W = Math.round((g.w * g.cell) / o.metresPerPixel);
  const H = Math.round((g.h * g.cell) / o.metresPerPixel);
  const mpp = o.metresPerPixel;
  // Pixel-resolution height with fine detail where there is relief.
  const ph = new Float64Array(W * H);
  const pb = new Float64Array(W * H);
  for (let py = 0; py < H; py++) {
    const y = (H - 1 - py + 0.5) * mpp;
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) * mpp;
      const base = sample(g, x, y);
      const detail = base > 0 ? fbm(x, y, { wavelength: 90, octaves: 4, gain: 0.55 }, o.seed + 3) * (1.5 + base * 0.02) : 0;
      ph[py * W + px] = base + detail;
      pb[py * W + px] = base;
    }
  }
  const coarse = blur(g, Math.max(2, Math.round(160 / g.cell)), 2);
  const lakeF = input.lake ? blur({ w: g.w, h: g.h, cell: g.cell, data: Float64Array.from(input.lake.data) }, 1, 1) : undefined;
  const inLake = (x: number, y: number): boolean => (lakeF ? sample(lakeF, x, y) > 0.5 : false);
  const rgb = new Uint8Array(W * H * 3);
  // Light directions (azimuth from north, clockwise), weights: NW key light plus fill (MDOW-style).
  const lights = [
    { az: 315, alt: 40, w: 0.55 },
    { az: 270, alt: 45, w: 0.2 },
    { az: 360, alt: 45, w: 0.15 },
    { az: 225, alt: 50, w: 0.1 },
  ].map((l) => {
    const az = (l.az * Math.PI) / 180;
    const alt = (l.alt * Math.PI) / 180;
    return { x: Math.sin(az) * Math.cos(alt), y: Math.cos(az) * Math.cos(alt), z: Math.sin(alt), w: l.w };
  });
  const cellOf = (x: number, y: number): number => {
    const gx = Math.min(g.w - 1, Math.max(0, Math.floor(x / g.cell)));
    const gy = Math.min(g.h - 1, Math.max(0, Math.floor(y / g.cell)));
    return gy * g.w + gx;
  };
  for (let py = 0; py < H; py++) {
    const y = (H - 1 - py + 0.5) * mpp;
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) * mpp;
      const i = py * W + px;
      const hc = ph[i]!;
      const ci = cellOf(x, y);
      const isLand = input.shore ? sample(input.shore, x, y) > 0 : pb[i]! > 0;
      let col: RGB;
      if (!isLand) {
        const depth = -hc;
        col = depth < 6 ? mix(SEA_SHORE, SEA_SHALLOW, clamp01(depth / 6)) : mix(SEA_SHALLOW, SEA_DEEP, clamp01((depth - 6) / 70));
      } else if (inLake(x, y)) {
        const depth = (input.lakeLevel ?? 0) - pb[i]!;
        col = mix(LAKE_SHORE, LAKE_DEEP, clamp01(depth / 12));
      } else {
        const cls = input.cover ? input.cover[ci]! : hc > 120 ? COVER_HIGH_FOREST : COVER_FOREST;
        const tone = fbm(x, y, { wavelength: 220, octaves: 3 }, o.seed + 11) * 0.5 + 0.5;
        switch (cls) {
          case COVER_HIGH_FOREST:
            col = mix(HIGH_FOREST, FOREST, tone * 0.5);
            break;
          case COVER_CLEARING:
            col = mix(CLEARING, FOREST, tone * 0.35);
            break;
          case COVER_MANGROVE:
            col = MANGROVE;
            break;
          case COVER_BEACH:
            col = mix(FOREST, CLEARING, 0.3);
            break;
          case COVER_PAVED:
            col = PAVED;
            break;
          default:
            col = mix(FOREST, HIGH_FOREST, clamp01(hc / 300) * 0.6 + tone * 0.25);
        }
        if (input.shore) {
          const sd = sample(input.shore, x, y);
          const beachy = fbm(x, y, { wavelength: 350, octaves: 3 }, o.seed + 51);
          const bw = 6 + 10 * Math.max(0, beachy);
          if (sd < bw && beachy > -0.15) col = mix(col, BEACH, clamp01(1.2 - sd / bw));
        }
        if (cls !== COVER_BEACH && cls !== COVER_PAVED) {
          const canopy = fbm(x, y, { wavelength: 28, octaves: 2 }, o.seed + 41);
          const kk = 1 + 0.16 * canopy;
          col = [col[0] * kk, col[1] * kk, col[2] * kk];
        }
        if (input.urban) {
          const u = sample(input.urban, x, y);
          if (u > 0.02) {
            // Block texture: a grid of ~30-40 m blocks whose orientation drifts with low-frequency
            // noise (neighbourhoods have their own grain), streets as lighter lines, scattered parks.
            const wx = x + 160 * fbm(x, y, { wavelength: 500, octaves: 2 }, o.seed + 24);
            const wy = y + 160 * fbm(x + 999, y, { wavelength: 500, octaves: 2 }, o.seed + 25);
            const ang = (hash01(Math.floor(wx / 450) * 977 + Math.floor(wy / 450), o.seed + 23) - 0.5) * 1.2;
            const ca = Math.cos(ang);
            const sa = Math.sin(ang);
            const ux = x * ca + y * sa;
            const uy = -x * sa + y * ca;
            const bw = u > 0.7 ? 30 : 40;
            const bx = Math.floor(ux / bw);
            const by = Math.floor(uy / (bw * 0.8));
            const fx = ux / bw - bx;
            const fy = uy / (bw * 0.8) - by;
            const street = fx < 0.14 || fy < 0.16;
            const roof = hash01(bx * 7919 + by * 31, o.seed + 21);
            const park = hash01(Math.floor(bx / 3) * 131 + Math.floor(by / 3), o.seed + 29) > 0.93;
            const urb = mix(URBAN_LOW, URBAN_HIGH, clamp01(u * 0.7 + roof * 0.35));
            let ucol = street ? mix(urb, [212, 204, 186], 0.55) : mix(urb, [104, 96, 90], roof * 0.35);
            if (park && !street) ucol = mix(FOREST, CLEARING, 0.35);
            const edge = clamp01((u - 0.02) * 4) * (u < 0.5 ? (hash01(bx * 13 + by * 7, o.seed + 37) < u * 1.6 ? 1 : 0.15) : 1);
            col = mix(col, ucol, edge);
          }
        }
      }
      // Shading (land and lake beds keep relief shading; sea gets a soft version).
      const hl = ph[py * W + Math.max(0, px - 1)]!;
      const hr = ph[py * W + Math.min(W - 1, px + 1)]!;
      const hu = ph[Math.max(0, py - 1) * W + px]!;
      const hd = ph[Math.min(H - 1, py + 1) * W + px]!;
      const ex = isLand ? o.exaggeration : o.exaggeration * 0.15;
      const dzdx = ((hr - hl) / (2 * mpp)) * ex;
      const dzdy = ((hu - hd) / (2 * mpp)) * ex;
      const nl = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const nx = -dzdx * nl;
      const ny = -dzdy * nl;
      const nz = nl;
      let shade = 0;
      for (const l of lights) shade += l.w * Math.max(0, nx * l.x + ny * l.y + nz * l.z);
      const flat = lights.reduce((s, l) => s + l.w * l.z, 0);
      let k = 0.45 + 0.75 * (shade / flat);
      if (isLand) {
        const ao = clamp01(1 + 0.006 * (sample(g, x, y) - sample(coarse, x, y)));
        k *= 0.65 + 0.45 * ao;
      }
      if (isLand && inLake(x, y)) k = 0.92 + 0.08 * k;
      rgb[i * 3] = Math.min(255, Math.max(0, col[0] * k));
      rgb[i * 3 + 1] = Math.min(255, Math.max(0, col[1] * k));
      rgb[i * 3 + 2] = Math.min(255, Math.max(0, col[2] * k));
    }
  }
  if (input.fills) for (const f of input.fills) fillRing(rgb, W, H, mpp, f.ring, f.color);
  if (input.strokes) for (const s of input.strokes) drawStroke(rgb, W, H, mpp, s);
  if (input.dots) for (const d of input.dots) drawDot(rgb, W, H, mpp, d);
  return { width: W, height: H, rgb };
}

function blend(rgb: Uint8Array, i: number, c: readonly number[], a: number): void {
  rgb[i * 3] = rgb[i * 3]! + (c[0]! - rgb[i * 3]!) * a;
  rgb[i * 3 + 1] = rgb[i * 3 + 1]! + (c[1]! - rgb[i * 3 + 1]!) * a;
  rgb[i * 3 + 2] = rgb[i * 3 + 2]! + (c[2]! - rgb[i * 3 + 2]!) * a;
}

function drawLine(rgb: Uint8Array, W: number, H: number, mpp: number, pts: readonly Vec2[], widthM: number, color: readonly number[], dash?: readonly [number, number]): void {
  const r = Math.max(0.6, widthM / mpp / 2);
  let along = 0;
  for (let s = 1; s < pts.length; s++) {
    const ax = pts[s - 1]!.x / mpp - 0.5;
    const ay = H - pts[s - 1]!.y / mpp - 0.5;
    const bx = pts[s]!.x / mpp - 0.5;
    const by = H - pts[s]!.y / mpp - 0.5;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r + 1));
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2));
        const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
        const a = clamp01(r + 0.5 - d);
        if (a > 0 && dash) {
          const m = (along + t * Math.sqrt(l2) * mpp) % (dash[0] + dash[1]);
          if (m > dash[0]) continue;
        }
        if (a > 0) {
          const i = y * W + x;
          // Avoid darkening joints twice: keep the max coverage by blending only toward the colour.
          blend(rgb, i, color, a);
        }
      }
    }
    along += Math.sqrt(l2) * mpp;
  }
}

function drawDot(rgb: Uint8Array, W: number, H: number, mpp: number, d: Dot): void {
  const cx = d.at.x / mpp - 0.5;
  const cy = H - d.at.y / mpp - 0.5;
  const R = d.radius / mpp;
  const inner = (d.radius - d.ringWidth) / mpp;
  const core = d.core ? d.core.radius / mpp : -1;
  for (let y = Math.max(0, Math.floor(cy - R - 1)); y <= Math.min(H - 1, Math.ceil(cy + R + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R - 1)); x <= Math.min(W - 1, Math.ceil(cx + R + 1)); x++) {
      const r = Math.hypot(x - cx, y - cy);
      const a = clamp01(R + 0.5 - r);
      if (a <= 0) continue;
      const i = y * W + x;
      const c = d.core && r <= core ? d.core.color : r <= inner ? d.fill : d.ring;
      blend(rgb, i, c, a);
    }
  }
}

function drawStroke(rgb: Uint8Array, W: number, H: number, mpp: number, s: Stroke): void {
  if (s.casing && s.casingColor) drawLine(rgb, W, H, mpp, s.points, s.width + 2 * s.casing, s.casingColor);
  drawLine(rgb, W, H, mpp, s.points, s.width, s.color, s.dash);
}

function fillRing(rgb: Uint8Array, W: number, H: number, mpp: number, ring: readonly Vec2[], color: readonly number[]): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  for (let py = Math.max(0, Math.floor(H - maxY / mpp)); py <= Math.min(H - 1, Math.ceil(H - minY / mpp)); py++) {
    const y = (H - 1 - py + 0.5) * mpp;
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let px = Math.max(0, Math.round(xs[k]! / mpp)); px < Math.min(W, Math.round(xs[k + 1]! / mpp)); px++) blend(rgb, py * W + px, color, 1);
    }
  }
}
