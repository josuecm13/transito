/**
 * Buildable area per block (issue #7, S5).
 *
 * Blocks are faces between street CENTERLINES, so the carriageway and sidewalks of every street
 * around a block eat into it. Buildable area = block polygon − union of "keep-out" buffers:
 *   - every street edge (cls != frame) near the block: distance <= width/2 + sidewalk (+ margin);
 *   - coast frame edges: distance <= coastSetback (a small strip so nothing sits on the shore);
 *   - barrier routes (runways, rails, canals; not graph edges): half their width + coastSetback.
 * Other frame edges (playable limit, active-area border, district border, connectors) cut nothing.
 *
 * Method: polygon-clipping `difference(block, ...buffers)`. Each segment buffer is a rectangle of
 * half-width r plus a regular 12-gon CIRCUMSCRIBED about the disc of radius r at each endpoint, so
 * the union always CONTAINS the exact Minkowski buffer (it over-cuts by at most ~3.5% of r at
 * caps). Every street near the block (bbox query, not only the block's own boundary edges) is
 * buffered, so a street across a frame line or an antenna inside the block is also respected.
 *
 * Parts of the difference that are nowhere `minWidth` wide (5 m, the engine's
 * MIN_BUILDABLE_WIDTH_METERS) are dropped; a block left with no part is a median (`isMedian`).
 * This refines the S3 estimate `Block.isMedian` without changing it.
 */
import type { WorldSpec } from '../spec.ts';
import type { Rect } from '../geometry.ts';
import type { Vec2 } from '../vec.ts';
import type { GraphSnapshot } from './planar-graph.ts';
import type { Block } from './faces.ts';
import { barrierLines } from './region.ts';
import type { Poly } from './poly.ts';
import type { PcPolygon } from './poly.ts';
import { capPolygon, clipHalfPlane, difference, hasWidth, isConvex, pointInPoly, polyArea, polyEdges, ringArea, segmentDistance, segmentRect } from './poly.ts';

export interface BuildableOptions {
  /** Setback from the coastline and from barrier edges (m). Default 3. */
  coastSetback: number;
  /** Extra clearance added to every street buffer (m), absorbs float error. Default 0.05. */
  margin: number;
  /** A part narrower than this everywhere is not buildable (m). Default 5. */
  minWidth: number;
}

export const DEFAULT_BUILDABLE: BuildableOptions = { coastSetback: 3, margin: 0.05, minWidth: 5 };

export interface BuildableArea {
  block: number;
  /** Buildable parts (each >= minWidth wide somewhere). Empty for medians. */
  parts: Poly[];
  /** Total area of `parts` (m²). */
  area: number;
  /** No part is minWidth wide. */
  isMedian: boolean;
}

/** A keep-out segment: a graph street, a coast frame edge, or a barrier route segment. */
export interface KeepOut {
  /** Graph edge id (streets and coast), -1 for barrier routes (not in the graph). */
  edge: number;
  /** A graph street (cls != frame): the only kind that gives frontage. */
  street: boolean;
  a: Vec2;
  b: Vec2;
  /** Buffer radius (m). */
  r: number;
  /** Largest cap radius on this segment's ends (0 = none), see `assignCaps`. */
  capR: number;
  /** Cap polygons owned by this segment (cover the parts of the end discs no rectangle covers). */
  caps: PcPolygon[];
}

/** Keep-out segments with a uniform grid for box queries (ids ascending → deterministic). */
export class KeepOutIndex {
  readonly items: KeepOut[];
  readonly maxR: number;
  private readonly cell: number;
  private readonly cells = new Map<number, number[]>();

  constructor(items: KeepOut[], cell = 64) {
    this.cell = cell;
    this.items = items;
    this.maxR = items.reduce((m, k) => Math.max(m, Math.max(k.r, k.capR) * 1.1), 0);
    items.forEach((k, id) => {
      const [x0, y0, x1, y1] = this.range(Math.min(k.a.x, k.b.x), Math.min(k.a.y, k.b.y), Math.max(k.a.x, k.b.x), Math.max(k.a.y, k.b.y));
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const key = (ix + 0x8000) * 0x10000 + (iy + 0x8000);
          const l = this.cells.get(key);
          if (l) l.push(id);
          else this.cells.set(key, [id]);
        }
      }
    });
  }

  private range(minX: number, minY: number, maxX: number, maxY: number): [number, number, number, number] {
    const s = this.cell;
    return [Math.floor(minX / s), Math.floor(minY / s), Math.floor(maxX / s), Math.floor(maxY / s)];
  }

  /** Items whose segment bbox, grown by its own r, meets the box. */
  query(box: Rect): KeepOut[] {
    const g = this.maxR;
    const [x0, y0, x1, y1] = this.range(box.minX - g, box.minY - g, box.maxX + g, box.maxY + g);
    const ids = new Set<number>();
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (const id of this.cells.get((ix + 0x8000) * 0x10000 + (iy + 0x8000)) ?? []) ids.add(id);
      }
    }
    const out: KeepOut[] = [];
    for (const id of [...ids].sort((p, q) => p - q)) {
      const k = this.items[id] as KeepOut;
      if (Math.max(k.a.x, k.b.x) + k.r < box.minX || Math.min(k.a.x, k.b.x) - k.r > box.maxX) continue;
      if (Math.max(k.a.y, k.b.y) + k.r < box.minY || Math.min(k.a.y, k.b.y) - k.r > box.maxY) continue;
      out.push(k);
    }
    return out;
  }
}

/** Street buffer radius of a graph edge (0 for frame edges): width/2 + sidewalk. */
export const streetRadius = (e: GraphSnapshot['edges'][number]): number => (e.cls === 'frame' ? 0 : e.width / 2 + e.sidewalk);

export function buildKeepOuts(spec: WorldSpec, rect: Rect, graph: GraphSnapshot, opts: BuildableOptions = DEFAULT_BUILDABLE): KeepOutIndex {
  const items: KeepOut[] = [];
  for (const e of graph.edges) {
    const a = graph.nodes[e.a] as Vec2;
    const b = graph.nodes[e.b] as Vec2;
    if (e.cls !== 'frame') {
      const r = streetRadius(e);
      if (r > 0) items.push({ edge: e.id, street: true, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, r: r + opts.margin, capR: 0, caps: [] });
    } else if (e.frame === 'coast' && opts.coastSetback > 0) {
      items.push({ edge: e.id, street: false, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, r: opts.coastSetback, capR: 0, caps: [] });
    }
  }
  for (const bl of barrierLines(spec, rect)) {
    for (const [a, b] of bl.segments) items.push({ edge: -1, street: false, a, b, r: bl.halfWidth + opts.coastSetback, capR: 0, caps: [] });
  }
  assignCaps(items);
  return new KeepOutIndex(items);
}

/**
 * Caps: the rectangles miss only parts of the discs around segment ends. At a point shared by
 * segment ends, sort the segments by direction:
 *   - all radii equal: within r of the node, a point in the angular gap from direction d1 to the
 *     next direction d2 is covered by rectangle 1 if it is within 90° of d1, by rectangle 2 if
 *     within 90° of d2. So only gaps wider than 180° leave an uncovered sector, spanning
 *     [d1 + 90°, d2 − 90°]; it gets a fan polygon circumscribing that arc (<= 30° per side).
 *     Dead ends (one segment) get a half disc; straight joints and convex corners get nothing.
 *     (Needs every segment at the node longer than r, so that projections stay on the segment.)
 *   - mixed radii (e.g. a local meeting an avenue) or a segment there no longer than the largest
 *     radius: one full circumscribed 12-gon of the largest radius.
 * Cap polygons are owned by the end's segment with the largest radius, so a box query that finds
 * the cap also finds its owner (`capR` widens the owner's query extent).
 */
export function assignCaps(items: KeepOut[]): void {
  const ends = new Map<string, { item: number; p: Vec2; angle: number; r: number; len: number }[]>();
  items.forEach((k, i) => {
    for (const end of ['a', 'b'] as const) {
      const p = k[end];
      const q = end === 'a' ? k.b : k.a;
      const key = `${p.x},${p.y}`;
      const l = ends.get(key) ?? [];
      l.push({ item: i, p, angle: Math.atan2(q.y - p.y, q.x - p.x), r: k.r, len: Math.hypot(q.x - p.x, q.y - p.y) });
      ends.set(key, l);
    }
  });
  for (const list of ends.values()) {
    list.sort((p, q) => p.angle - q.angle || p.item - q.item);
    const rMax = Math.max(...list.map((e) => e.r));
    const rMin = Math.min(...list.map((e) => e.r));
    let owner = list[0] as (typeof list)[number];
    for (const e of list) if (e.r > owner.r || (e.r === owner.r && e.item < owner.item)) owner = e;
    const polys: PcPolygon[] = [];
    if (rMax !== rMin || list.some((e) => e.len <= rMax)) {
      polys.push(capPolygon(owner.p, rMax));
    } else {
      for (let i = 0; i < list.length; i++) {
        const a = (list[i] as (typeof list)[number]).angle;
        const b = list.length === 1 ? a + 2 * Math.PI : i + 1 < list.length ? (list[i + 1] as (typeof list)[number]).angle : (list[0] as (typeof list)[number]).angle + 2 * Math.PI;
        if (b - a > Math.PI + 1e-9) polys.push(sectorPolygon(owner.p, rMax, a + Math.PI / 2, b - Math.PI / 2));
      }
    }
    if (polys.length === 0) continue;
    const k = items[owner.item] as KeepOut;
    k.caps.push(...polys);
    k.capR = Math.max(k.capR, rMax / Math.cos(Math.PI / 12));
  }
}

/** Fan polygon (c, arc from angle t0 to t1 CCW) whose outer edges are tangent to radius r. */
export function sectorPolygon(c: Vec2, r: number, t0: number, t1: number): PcPolygon {
  const span = t1 - t0;
  const m = Math.max(1, Math.ceil(span / (Math.PI / 6) - 1e-9));
  const R = r / Math.cos(span / (2 * m));
  const ring: [number, number][] = [[c.x, c.y]];
  for (let k = 0; k <= m; k++) {
    const t = t0 + (span * k) / m;
    ring.push([c.x + R * Math.cos(t), c.y + R * Math.sin(t)]);
  }
  ring.push([c.x, c.y]);
  return [ring];
}

/** Polygons whose union contains the exact buffer of the given keep-outs (rects + needed caps). */
export function keepOutPolygons(items: readonly KeepOut[]): PcPolygon[] {
  const out: PcPolygon[] = [];
  for (const k of items) {
    const rect = segmentRect(k.a, k.b, k.r);
    if (rect) out.push(rect);
    out.push(...k.caps);
  }
  return out;
}

function ringBox(r: readonly Vec2[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of r) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function blockPoly(b: Block): Poly {
  return { outer: b.ring.map((p) => ({ x: p.x, y: p.y })), holes: b.holes.map((h) => h.map((p) => ({ x: p.x, y: p.y }))) };
}

/** The keep-out buffer of k meets polygon p (segment within k.r of p, or inside it). */
function reaches(k: KeepOut, p: Poly): boolean {
  if (pointInPoly(k.a, p)) return true;
  const r = Math.max(k.r, k.capR) * 1.1;
  for (const [c, d] of polyEdges(p)) if (segmentDistance(k.a, k.b, c, d) <= r) return true;
  return false;
}

/**
 * Keep-out radius of each ring side (graph edge between ringNodes[i] and ringNodes[i+1]), or
 * undefined when a side is not a single graph edge (should not happen for faces).
 */
function ringSideEdges(block: Block, graph: GraphSnapshot): number[] | undefined {
  const byPair = new Map<string, number>();
  for (const r of block.boundary) {
    const e = graph.edges[r.edge] as GraphSnapshot['edges'][number];
    const o = r.forward ? e.a : e.b;
    const d = r.forward ? e.b : e.a;
    byPair.set(`${o}>${d}`, e.id);
  }
  const n = block.ringNodes.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = byPair.get(`${block.ringNodes[i]}>${block.ringNodes[(i + 1) % n]}`);
    if (id === undefined) return undefined;
    out.push(id);
  }
  return out;
}

/**
 * Fast exact path for a convex block without holes: inside a convex polygon, the points within
 * r of a side are exactly those within r of its LINE, so block − buffers(sides) = the block
 * clipped by every side's inward half-plane offset by its radius (Sutherland–Hodgman). Any other
 * keep-out that still reaches the result (antenna, a street across a frame line, a barrier) is
 * subtracted afterwards with polygon-clipping.
 */
function convexBuildable(block: Block, graph: GraphSnapshot, keepOuts: KeepOutIndex, near: readonly KeepOut[]): Poly[] | undefined {
  if (block.holes.length > 0 || !isConvex(block.ring)) return undefined;
  const sides = ringSideEdges(block, graph);
  if (!sides) return undefined;
  const radius = new Map<number, number>();
  for (const k of near) if (k.edge >= 0) radius.set(k.edge, k.r);
  let ring: Vec2[] = block.ring.map((p) => ({ x: p.x, y: p.y }));
  const n = block.ring.length;
  for (let i = 0; i < n && ring.length >= 3; i++) {
    const r = radius.get(sides[i] as number) ?? 0;
    if (r <= 0) continue;
    const a = block.ring[i] as Vec2;
    const b = block.ring[(i + 1) % n] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const nrm = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    ring = clipHalfPlane(ring, { x: a.x + nrm.x * r, y: a.y + nrm.y * r }, nrm);
  }
  if (ring.length < 3 || ringArea(ring) < 1) return [];
  const result: Poly = { outer: ring, holes: [] };
  const sideSet = new Set(sides);
  const rest = near.filter((k) => !(k.edge >= 0 && sideSet.has(k.edge)) && reaches(k, result));
  if (rest.length === 0) return [result];
  // polygon-clipping failure: nothing buildable here (conservative).
  return difference(result, keepOutPolygons(rest), 1) ?? [];
}

export function buildableArea(block: Block, graph: GraphSnapshot, keepOuts: KeepOutIndex, opts: BuildableOptions = DEFAULT_BUILDABLE): BuildableArea {
  const poly = blockPoly(block);
  const near = block.ring.length >= 3 ? keepOuts.query(ringBox(block.ring)).filter((k) => reaches(k, poly)) : [];
  const raw = block.ring.length < 3 ? [] : (convexBuildable(block, graph, keepOuts, near) ?? difference(poly, keepOutPolygons(near), 1) ?? []);
  const parts = raw.filter((p) => hasWidth(p, opts.minWidth));
  return { block: block.id, parts, area: parts.reduce((s, p) => s + polyArea(p), 0), isMedian: parts.length === 0 };
}

/** Buildable area of every block, indexed like `blocks` (block ids are 0..n-1). */
export function computeBuildable(blocks: readonly Block[], graph: GraphSnapshot, keepOuts: KeepOutIndex, opts: BuildableOptions = DEFAULT_BUILDABLE): BuildableArea[] {
  return blocks.map((b) => buildableArea(b, graph, keepOuts, opts));
}
