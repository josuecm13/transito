/**
 * Where streets may go (issue #7, S3): frame lines of the active area and per-district regions.
 *
 * Frame = everything that bounds blocks without being a street, inside the active-area rect:
 *   coast    — geometry.land and islands shoreline (edges lying on the bounds box are not coast)
 *   limit    — geometry.playable_boundary west/east lines
 *   area     — the active-area rectangle
 *   district — borders between grid cells of different districts (the only district geometry
 *              the spec has; README: the grid is an area budget, so these are provisional)
 * Frame segments outside playable land are harmless: faces there are discarded.
 */
import type { Route, WorldSpec } from '../spec.ts';
import { districtAt } from '../spec.ts';
import type { WorldSlice } from '../slice.ts';
import type { Vec2 } from '../vec.ts';
import type { Rect } from '../geometry.ts';
import { clipPolylineToRect, clipSegmentToRect, segmentsOfPolygon } from '../geometry.ts';
import type { FrameKind } from './planar-graph.ts';
import { projectOnSegment } from './planar-graph.ts';

export interface FrameSegment {
  a: Vec2;
  b: Vec2;
  kind: Exclude<FrameKind, 'connector'>;
}

/** Route kinds that are avenues (fixed street constraints). README "Streets". */
export const AVENUE_KINDS: ReadonlySet<string> = new Set(['arterial', 'highway']);
/** Route kinds that streets may not cross or run on (runways, rails, canals). */
export const BARRIER_KINDS: ReadonlySet<string> = new Set(['runway', 'rail', 'waterway']);

const onBoundsEdge = (a: Vec2, b: Vec2, w: number, h: number): boolean =>
  (a.x === 0 && b.x === 0) || (a.x === w && b.x === w) || (a.y === 0 && b.y === 0) || (a.y === h && b.y === h);

export function buildFrame(spec: WorldSpec, rect: Rect): FrameSegment[] {
  const out: FrameSegment[] = [];
  const { width: W, height: H } = spec.bounds;
  const rings = [spec.land, ...spec.islands.map((i) => i.points)];
  for (const ring of rings) {
    for (const [a, b] of segmentsOfPolygon(ring)) {
      if (onBoundsEdge(a, b, W, H)) continue;
      const c = clipSegmentToRect(a, b, rect);
      if (c && (c[0].x !== c[1].x || c[0].y !== c[1].y)) out.push({ a: c[0], b: c[1], kind: 'coast' });
    }
  }
  for (const line of [spec.playableBoundary.west, spec.playableBoundary.east]) {
    for (const piece of clipPolylineToRect(line, rect)) {
      for (let i = 0; i < piece.length - 1; i++) {
        const a = piece[i] as Vec2;
        const b = piece[i + 1] as Vec2;
        if (a.x !== b.x || a.y !== b.y) out.push({ a, b, kind: 'limit' });
      }
    }
  }
  const sw = { x: rect.minX, y: rect.minY };
  const se = { x: rect.maxX, y: rect.minY };
  const ne = { x: rect.maxX, y: rect.maxY };
  const nw = { x: rect.minX, y: rect.maxY };
  out.push({ a: sw, b: se, kind: 'area' }, { a: se, b: ne, kind: 'area' }, { a: ne, b: nw, kind: 'area' }, { a: nw, b: sw, kind: 'area' });

  // District borders: shared edges of grid cells with different codes, clipped to the rect.
  const cs = spec.bounds.cellSize;
  const rows = spec.grid.length;
  const code = (c: number, r: number): string | undefined => spec.grid[r]?.[c];
  for (let r = 0; r < rows; r++) {
    const row = spec.grid[r] as string[];
    for (let c = 0; c < row.length; c++) {
      const y0 = (rows - 1 - r) * cs;
      const x0 = c * cs;
      const me = code(c, r);
      const east = code(c + 1, r);
      const south = code(c, r + 1);
      const segs: [Vec2, Vec2][] = [];
      if (east !== undefined && east !== me) segs.push([{ x: x0 + cs, y: y0 }, { x: x0 + cs, y: y0 + cs }]);
      if (south !== undefined && south !== me) segs.push([{ x: x0, y: y0 }, { x: x0 + cs, y: y0 }]);
      for (const [a, b] of segs) {
        const cl = clipSegmentToRect(a, b, rect);
        if (!cl) continue;
        const [p, q] = cl;
        if (p.x === q.x && p.y === q.y) continue;
        const onRect =
          (p.x === q.x && (p.x === rect.minX || p.x === rect.maxX)) || (p.y === q.y && (p.y === rect.minY || p.y === rect.maxY));
        if (!onRect) out.push({ a: p, b: q, kind: 'district' });
      }
    }
  }
  return out;
}

/** Barrier routes (runways…) clipped to the rect, with their half width. */
export function barrierLines(spec: WorldSpec, rect: Rect): { route: Route; halfWidth: number; segments: [Vec2, Vec2][] }[] {
  const out: { route: Route; halfWidth: number; segments: [Vec2, Vec2][] }[] = [];
  for (const route of spec.routes) {
    if (!BARRIER_KINDS.has(route.kind)) continue;
    const w = route.width ?? spec.streetProfiles[route.kind]?.width ?? 0;
    const segments: [Vec2, Vec2][] = [];
    for (const piece of clipPolylineToRect(route.points, rect)) {
      for (let i = 0; i < piece.length - 1; i++) segments.push([piece[i] as Vec2, piece[i + 1] as Vec2]);
    }
    if (segments.length > 0) out.push({ route, halfWidth: w / 2, segments });
  }
  return out;
}

/** Distance queries against a fixed set of segments (uniform grid). */
export class SegmentIndex<T> {
  private readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  readonly items: { a: Vec2; b: Vec2; data: T }[] = [];

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(ix: number, iy: number): number {
    return (ix + 0x8000) * 0x10000 + (iy + 0x8000);
  }

  add(a: Vec2, b: Vec2, data: T): void {
    const id = this.items.length;
    this.items.push({ a, b, data });
    const s = this.cell;
    for (let ix = Math.floor(Math.min(a.x, b.x) / s); ix <= Math.floor(Math.max(a.x, b.x) / s); ix++) {
      for (let iy = Math.floor(Math.min(a.y, b.y) / s); iy <= Math.floor(Math.max(a.y, b.y) / s); iy++) {
        const k = this.key(ix, iy);
        const l = this.cells.get(k);
        if (l) l.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }

  /** Nearest segment within r accepted by pred: distance, closest point and data. */
  nearest(p: Vec2, r: number, pred: (d: T) => boolean = () => true): { dist: number; point: Vec2; data: T } | undefined {
    const s = this.cell;
    let best: { dist: number; point: Vec2; data: T } | undefined;
    const seen = new Set<number>();
    for (let ix = Math.floor((p.x - r) / s); ix <= Math.floor((p.x + r) / s); ix++) {
      for (let iy = Math.floor((p.y - r) / s); iy <= Math.floor((p.y + r) / s); iy++) {
        for (const id of this.cells.get(this.key(ix, iy)) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const it = this.items[id] as { a: Vec2; b: Vec2; data: T };
          if (!pred(it.data)) continue;
          const pr = projectOnSegment(p, it.a, it.b);
          const d = Math.sqrt(pr.d2);
          if (d <= r && (!best || d < best.dist)) best = { dist: d, point: { x: pr.x, y: pr.y }, data: it.data };
        }
      }
    }
    return best;
  }
}

/** One district's buildable street area inside the active rect. */
export interface DistrictRegion {
  id: string;
  /** Bounding box of the district's grid cells clipped to the active rect. */
  box: Rect;
  /** Inside the district (grid) and on playable land. */
  contains(p: Vec2): boolean;
  /**
   * Distance from p to the nearest coast / limit / district frame or barrier edge (m), capped at
   * `cap`. The active-area border is not counted: streets may run up to it.
   */
  clearance(p: Vec2, cap: number): number;
  /** Nearest frame point (any kind except area unless `includeArea`) within r. */
  nearestFrame(p: Vec2, r: number, includeArea?: boolean): { dist: number; point: Vec2; kind: FrameSegment['kind'] } | undefined;
}

export function districtBox(spec: WorldSpec, id: string, rect: Rect): Rect | undefined {
  const cs = spec.bounds.cellSize;
  const rows = spec.grid.length;
  const code = spec.districts.find((d) => d.id === id)?.code;
  let box: Rect | undefined;
  spec.grid.forEach((row, r) =>
    row.forEach((c, ci) => {
      if (c !== code) return;
      const x0 = Math.max(ci * cs, rect.minX);
      const x1 = Math.min((ci + 1) * cs, rect.maxX);
      const y0 = Math.max((rows - 1 - r) * cs, rect.minY);
      const y1 = Math.min((rows - r) * cs, rect.maxY);
      if (x0 >= x1 || y0 >= y1) return;
      box = box
        ? { minX: Math.min(box.minX, x0), minY: Math.min(box.minY, y0), maxX: Math.max(box.maxX, x1), maxY: Math.max(box.maxY, y1) }
        : { minX: x0, minY: y0, maxX: x1, maxY: y1 };
    }),
  );
  return box;
}

export function buildFrameIndex(frame: readonly FrameSegment[], spec: WorldSpec, rect: Rect): SegmentIndex<{ kind: FrameSegment['kind'] | 'barrier'; halfWidth: number }> {
  const idx = new SegmentIndex<{ kind: FrameSegment['kind'] | 'barrier'; halfWidth: number }>(64);
  for (const f of frame) idx.add(f.a, f.b, { kind: f.kind, halfWidth: 0 });
  for (const b of barrierLines(spec, rect)) for (const [p, q] of b.segments) idx.add(p, q, { kind: 'barrier', halfWidth: b.halfWidth });
  return idx;
}

export function createDistrictRegion(
  spec: WorldSpec,
  slice: WorldSlice,
  id: string,
  frameIndex: SegmentIndex<{ kind: FrameSegment['kind'] | 'barrier'; halfWidth: number }>,
): DistrictRegion | undefined {
  const box = districtBox(spec, id, slice.rect);
  if (!box) return undefined;
  const maxHalf = frameIndex.items.reduce((m, it) => Math.max(m, it.data.halfWidth), 0);
  return {
    id,
    box,
    contains: (p) => districtAt(spec, p)?.id === id && slice.isPlayableLand(p),
    clearance: (p, cap) => {
      let best = cap;
      const nf = frameIndex.nearest(p, cap, (d) => d.kind !== 'area' && d.kind !== 'barrier');
      if (nf) best = Math.min(best, nf.dist);
      if (maxHalf > 0) {
        // Barriers count from their edge (nearest centerline; barriers of one route share a width).
        const nb = frameIndex.nearest(p, cap + maxHalf, (d) => d.kind === 'barrier');
        if (nb) best = Math.min(best, nb.dist - nb.data.halfWidth);
      }
      return Math.max(0, best);
    },
    nearestFrame: (p, r, includeArea = false) => {
      const n = frameIndex.nearest(p, r, (d) => d.kind !== 'barrier' && (includeArea || d.kind !== 'area'));
      return n ? { dist: n.dist, point: n.point, kind: n.data.kind as FrameSegment['kind'] } : undefined;
    },
  };
}
