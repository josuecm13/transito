/**
 * Per-sector slice of the baked isthmus (card 7 of docs/map-reshape/03-technical/12-sectors-and-streaming.md). Pure:
 * no DOM, no I/O. The codec format and the game's load path are untouched; this only cuts a decoded `Isthmus`.
 *
 *   sliceIsthmus(iso, table, id)  one sector: every per-cell array cut to a area, vectors kept where they touch it
 *   assembleIsthmus(slices, base) inverse for the rasters: every per-cell array rebuilt from the slices
 *   sliceBytes(slice)             byte report
 *
 * Ownership: a cell belongs to the sector `sectorOf` gives its centre, so the 7 owned sets tile the grid exactly once
 * (ribera and ciudad share a box but are split along the canal border, so a bounding box alone would overlap).
 * Window = bounding box of the owned cells plus a 1-cell APRON (clamped to the grid): `sample` (bilinear, reads x+1 / y+1)
 * and the 8-neighbour slope/flow stencils need one cell of the neighbour. Windows of neighbours therefore overlap by the
 * apron and (ribera/ciudad, lago's L-shape) by their bounding boxes; `owned` says which area cells are the sector's own.
 * "Per-cell array" = any typed array whose length is w*h of the base grid (found by walking the isthmus), EXCEPT
 * `relief.routing.stack`, a global processing order (a permutation of all cells), which is not spatial and stays in `base`.
 * Vector data (rivers, canal, locks, airport, roads, transit, landmarks, trails, Act 1 strip): an item is kept when any
 * of its points is owned by the sector (whole, not clipped); point lists (canal centreline) keep only the owned points.
 */
import type { Isthmus } from './proc/isthmus.ts';
import { sectorOf, type SectorTable } from './sectors.ts';

type Typed = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Int8Array | Uint8Array;
type Ctor = new (n: number) => Typed;
const isTyped = (v: unknown): v is Typed => ArrayBuffer.isView(v) && !(v instanceof DataView);

/** Typed arrays that have w*h entries but are not per-cell data. */
const NOT_SPATIAL = new Set(['relief.routing.stack']);
export const SLICE_APRON = 1;

export interface SliceVectors {
  rivers: readonly unknown[];
  canalCentreline: readonly unknown[];
  canalLocks: readonly unknown[];
  /** The airport (field, runways, terminal...) when any of its points is owned, else null. */
  airport: unknown | null;
  roadPaths: readonly unknown[];
  transitLines: readonly unknown[];
  transitStations: readonly unknown[];
  landmarks: readonly unknown[];
  trails: readonly unknown[];
  act1Strip: unknown | null;
}

export interface SectorSlice {
  id: string;
  /** Base grid shape the paths below index into. */
  shape: { w: number; h: number; cell: number };
  /** Window in cells, half-open, apron included: [gx0, gx1) x [gy0, gy1). */
  area: { gx0: number; gy0: number; gx1: number; gy1: number };
  /** 1 where the area cell belongs to this sector (apron cells and other sectors' bounding-box cells are 0). */
  owned: Uint8Array;
  ownedCells: number;
  /** Per-cell arrays by isthmus path (e.g. `height.data`), each cut to the area, row-major, width gx1 - gx0. */
  arrays: Record<string, Typed>;
  vectors: SliceVectors;
}

/** Every per-cell typed array of the isthmus by path, in a stable order. */
export function cellArrays(iso: Isthmus): Record<string, Typed> {
  const n = iso.height.w * iso.height.h;
  const out: Record<string, Typed> = {};
  const walk = (v: unknown, path: string): void => {
    if (isTyped(v)) {
      if (v.length === n && !NOT_SPATIAL.has(path)) out[path] = v as Typed;
      return;
    }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return;
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
  };
  walk(iso, '');
  return out;
}

/** True when any {x, y} found inside `v` is owned. */
function touches(v: unknown, owns: (x: number, y: number) => boolean): boolean {
  if (v === null || typeof v !== 'object' || isTyped(v)) return false;
  if (Array.isArray(v)) return v.some((e) => touches(e, owns));
  const o = v as Record<string, unknown>;
  if (typeof o.x === 'number' && typeof o.y === 'number') return owns(o.x, o.y);
  return Object.values(o).some((e) => touches(e, owns));
}

export function sliceIsthmus(iso: Isthmus, table: SectorTable, sectorId: string): SectorSlice {
  if (!table.sectors.some((s) => s.id === sectorId)) throw new RangeError(`sliceIsthmus: unknown sector "${sectorId}"`);
  const { w, h, cell } = iso.height;
  const ownsCell = (gx: number, gy: number): boolean => sectorOf(table, (gx + 0.5) * cell, (gy + 0.5) * cell).id === sectorId;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const own = new Uint8Array(w * h);
  for (let gy = 0; gy < h; gy++)
    for (let gx = 0; gx < w; gx++)
      if (ownsCell(gx, gy)) {
        own[gy * w + gx] = 1;
        if (gx < x0) x0 = gx;
        if (gx > x1) x1 = gx;
        if (gy < y0) y0 = gy;
        if (gy > y1) y1 = gy;
      }
  if (x1 < 0) throw new Error(`sliceIsthmus: sector "${sectorId}" owns no cell`);
  const area = { gx0: Math.max(0, x0 - SLICE_APRON), gy0: Math.max(0, y0 - SLICE_APRON), gx1: Math.min(w, x1 + 1 + SLICE_APRON), gy1: Math.min(h, y1 + 1 + SLICE_APRON) };
  const ww = area.gx1 - area.gx0;
  const wh = area.gy1 - area.gy0;
  const cut = <T extends Typed>(src: T): T => {
    const out = new (src.constructor as new (n: number) => T)(ww * wh);
    for (let gy = area.gy0; gy < area.gy1; gy++) out.set(src.subarray(gy * w + area.gx0, gy * w + area.gx1), (gy - area.gy0) * ww);
    return out;
  };
  const owned = cut(own);
  let ownedCells = 0;
  for (let i = 0; i < owned.length; i++) ownedCells += owned[i]!;
  const arrays: Record<string, Typed> = {};
  for (const [path, a] of Object.entries(cellArrays(iso))) arrays[path] = cut(a);

  const owns = (x: number, y: number): boolean => sectorOf(table, x, y).id === sectorId;
  const keep = (items: readonly unknown[]): unknown[] => items.filter((it) => touches(it, owns));
  const vectors: SliceVectors = {
    rivers: keep(iso.rivers),
    canalCentreline: iso.canal.centreline.filter((p) => owns(p.x, p.y)),
    canalLocks: keep(iso.canal.locks),
    airport: touches(iso.airport, owns) ? iso.airport : null,
    roadPaths: keep(iso.roads.paths),
    transitLines: keep(iso.transit.lines),
    transitStations: keep(iso.transit.stations),
    landmarks: keep(iso.landmarks),
    trails: keep(iso.trails),
    act1Strip: touches(iso.act1.strip, owns) ? iso.act1.strip : null,
  };
  return { id: sectorId, shape: { w, h, cell }, area, owned, ownedCells, arrays, vectors };
}

/** Typed-array bytes: of the areas (what a resident sector holds) and of the owned cells only (the share that sums to the whole). */
export function sliceBytes(s: SectorSlice): { area: number; owned: number } {
  let area = 0;
  let owned = 0;
  for (const a of Object.values(s.arrays)) {
    area += a.byteLength;
    owned += s.ownedCells * a.BYTES_PER_ELEMENT;
  }
  return { area, owned };
}

/** Per-cell arrays rebuilt from the slices (owned cells only). Throws when a cell is claimed twice or by nobody. */
export function assembleArrays(slices: readonly SectorSlice[]): Record<string, Typed> {
  if (slices.length === 0) throw new RangeError('assembleArrays: no slices');
  const { w, h } = slices[0]!.shape;
  const out: Record<string, Typed> = {};
  for (const [path, a] of Object.entries(slices[0]!.arrays)) out[path] = new (a.constructor as Ctor)(w * h);
  const seen = new Uint8Array(w * h);
  for (const s of slices) {
    const { gx0, gy0, gx1, gy1 } = s.area;
    const ww = gx1 - gx0;
    for (let gy = gy0; gy < gy1; gy++)
      for (let gx = gx0; gx < gx1; gx++) {
        const k = (gy - gy0) * ww + (gx - gx0);
        if (!s.owned[k]) continue;
        const i = gy * w + gx;
        if (seen[i]) throw new Error(`assembleArrays: cell (${gx}, ${gy}) is owned by two slices`);
        seen[i] = 1;
        for (const path of Object.keys(out)) out[path]![i] = s.arrays[path]![k]!;
      }
  }
  const missing = seen.indexOf(0);
  if (missing >= 0) throw new Error(`assembleArrays: cell ${missing} is owned by no slice`);
  return out;
}

/** `base` with every per-cell array replaced by the one assembled from the slices (vectors, scalars and the routing stack stay `base`'s). */
export function assembleIsthmus(slices: readonly SectorSlice[], base: Isthmus): Isthmus {
  const arrays = assembleArrays(slices);
  const rebuild = (v: unknown, path: string): unknown => {
    if (isTyped(v)) return arrays[path] ?? v;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = rebuild((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    return out;
  };
  return rebuild(base, '') as Isthmus;
}
