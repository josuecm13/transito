/**
 * Raster grid shared by the procedural map functions (docs/map-reshape/01-investigation/procedural-techniques.md).
 *
 * Cell (gx, gy) has its centre at ((gx + 0.5) * cell, (gy + 0.5) * cell) in map metres: origin at the
 * south-west corner, +y north. Index = gy * w + gx. Every function in `proc/` is pure: same input, same output.
 */
export interface GridShape {
  readonly w: number;
  readonly h: number;
  /** Cell size in metres. */
  readonly cell: number;
}

export interface FieldGrid extends GridShape {
  readonly data: Float64Array;
}

export interface MaskGrid extends GridShape {
  readonly data: Uint8Array;
}

export function makeShape(width: number, height: number, cell: number): GridShape {
  return { w: Math.round(width / cell), h: Math.round(height / cell), cell };
}

export function field(shape: GridShape, fill = 0): FieldGrid {
  const data = new Float64Array(shape.w * shape.h);
  if (fill !== 0) data.fill(fill);
  return { w: shape.w, h: shape.h, cell: shape.cell, data };
}

export function mask(shape: GridShape): MaskGrid {
  return { w: shape.w, h: shape.h, cell: shape.cell, data: new Uint8Array(shape.w * shape.h) };
}

export const centreX = (g: GridShape, gx: number): number => (gx + 0.5) * g.cell;
export const centreY = (g: GridShape, gy: number): number => (gy + 0.5) * g.cell;

/** Index of the cell containing map point (x, y), clamped to the grid. */
export function cellAt(g: GridShape, x: number, y: number): number {
  const gx = Math.min(g.w - 1, Math.max(0, Math.floor(x / g.cell)));
  const gy = Math.min(g.h - 1, Math.max(0, Math.floor(y / g.cell)));
  return gy * g.w + gx;
}

/** Bilinear sample at map point (x, y) over cell centres, clamped at the border. */
export function sample(f: FieldGrid, x: number, y: number): number {
  const fx = Math.min(f.w - 1, Math.max(0, x / f.cell - 0.5));
  const fy = Math.min(f.h - 1, Math.max(0, y / f.cell - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(f.w - 1, x0 + 1);
  const y1 = Math.min(f.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = f.data;
  const a = d[y0 * f.w + x0]! + (d[y0 * f.w + x1]! - d[y0 * f.w + x0]!) * tx;
  const b = d[y1 * f.w + x0]! + (d[y1 * f.w + x1]! - d[y1 * f.w + x0]!) * tx;
  return a + (b - a) * ty;
}

/** 8-neighbour offsets, fixed order (E, NE, N, NW, W, SW, S, SE) so every traversal is deterministic. */
export const DX8 = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const DY8 = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const DIST8 = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2] as const;

/**
 * Binary min-heap of cell indices keyed by a float, ties broken by the smaller index. Deterministic
 * for equal keys, which priority-flood and Dijkstra need.
 */
export class MinHeap {
  private keys: Float64Array;
  private items: Int32Array;
  private n = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(Math.max(16, capacity));
    this.items = new Int32Array(Math.max(16, capacity));
  }

  get size(): number {
    return this.n;
  }

  private less(i: number, j: number): boolean {
    const a = this.keys[i]!;
    const b = this.keys[j]!;
    return a < b || (a === b && this.items[i]! < this.items[j]!);
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i]!;
    this.keys[i] = this.keys[j]!;
    this.keys[j] = k;
    const t = this.items[i]!;
    this.items[i] = this.items[j]!;
    this.items[j] = t;
  }

  push(item: number, key: number): void {
    if (this.n === this.keys.length) {
      const k = new Float64Array(this.n * 2);
      k.set(this.keys);
      this.keys = k;
      const it = new Int32Array(this.n * 2);
      it.set(this.items);
      this.items = it;
    }
    let i = this.n++;
    this.keys[i] = key;
    this.items[i] = item;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Key of the top item (call only when size > 0). */
  topKey(): number {
    return this.keys[0]!;
  }

  pop(): number {
    const top = this.items[0]!;
    this.n--;
    if (this.n > 0) {
      this.keys[0] = this.keys[this.n]!;
      this.items[0] = this.items[this.n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** Separable box blur repeated `passes` times (≈ Gaussian), radius in cells. Returns a new field. */
export function blur(f: FieldGrid, radius: number, passes = 2): FieldGrid {
  const { w, h } = f;
  const src = Float64Array.from(f.data);
  const tmp = new Float64Array(w * h);
  const r = Math.max(1, Math.round(radius));
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += src[y * w + Math.min(w - 1, x + r + 1)]! - src[y * w + Math.max(0, x - r)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        src[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
      }
    }
  }
  return { w, h, cell: f.cell, data: src };
}

/**
 * Exact-enough Euclidean distance transform (two-pass 8-neighbour chamfer, 1 / √2 weights) from every
 * cell where `source[i] !== 0`. Distances in metres. Error vs true Euclidean ≤ 8 %, fine for falloffs.
 */
export function distanceFrom(source: MaskGrid): FieldGrid {
  const { w, h, cell } = source;
  const d = new Float64Array(w * h).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < w * h; i++) if (source.data[i]) d[i] = 0;
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + a);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + a);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + b);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + b);
      }
      d[i] = v;
    }
  }
  return { w, h, cell, data: d };
}
