/**
 * Flat street surfaces from the street graph, as triangle soups in the spec plane (meters).
 * Pure: renderers (three in engine/, canvas in ui/) only assign colour and height.
 *
 * Per street edge (frame edges are skipped):
 *   - carriageway: rectangle a→b, `width` wide, in the layer of the edge's class;
 *   - sidewalk: two strips [width/2, width/2 + sidewalk] on each side (when sidewalk > 0);
 *   - markings: a centre line on avenues (solid) and collectors (dashed), trimmed at each end by
 *     the half width of any wider-class street meeting it there, so it never runs onto that street.
 * Per node, joints of radius max(width/2 + sidewalk) in the sidewalk layer and width/2 of the
 * highest-class street in that class's layer:
 *   - every angular gap wider than 180° between consecutive streets (outer side of a bend, the end
 *     of a dead end) gets an exact circular sector from one street's band edge to the next one's,
 *     so the joint meets the bands without slivers (rounded corners, rounded dead ends);
 *   - nodes with 3+ streets also get a full disc (fills the centre under unequal widths / acute
 *     angles). Straight degree-2 nodes get nothing.
 * Renderers stack the layers bottom-up: sidewalk, alley, local, collector, avenue, markings;
 * painting in that order gives clean T / X joints without polygon unions.
 *
 * Every triangle is counter-clockwise in the spec plane (faces +Y in the scene).
 */
import type { Vec2 } from './vec.ts';
import type { GraphSnapshot, StreetClass } from './streets/planar-graph.ts';

/** Indexed triangles; `positions` holds x, y pairs (spec plane). */
export interface TriSoup {
  positions: number[];
  indices: number[];
}

export const STREET_LAYERS: readonly StreetClass[] = ['alley', 'local', 'collector', 'avenue'];

export interface StreetSurfaces {
  sidewalk: TriSoup;
  carriageway: Record<StreetClass, TriSoup>;
  centerSolid: TriSoup;
  centerDashed: TriSoup;
}

export interface SurfaceOptions {
  /** Segments of a full joint disc. */
  discSegments: number;
  /** Largest angle (rad) of one segment of a joint sector arc. */
  arcStep: number;
  /** Bends sharper than this (rad) get a joint sector on their outer side; straighter ones none. */
  straightTurn: number;
  /** Centre line width (m). */
  lineWidth: number;
  /** Dashed centre line: dash and gap length (m). */
  dash: number;
  gap: number;
}

export const DEFAULT_SURFACE: SurfaceOptions = {
  discSegments: 16,
  arcStep: (10 * Math.PI) / 180,
  straightTurn: (0.1 * Math.PI) / 180,
  lineWidth: 0.3,
  dash: 3,
  gap: 3,
};

const RANK: Record<StreetClass, number> = { alley: 0, local: 1, collector: 2, avenue: 3 };

export const emptySoup = (): TriSoup => ({ positions: [], indices: [] });

/** Quad a0, a1, b1, b0 given CCW; appends two triangles. */
function pushQuad(s: TriSoup, p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): void {
  const i = s.positions.length / 2;
  s.positions.push(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  s.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

/**
 * Band along segment a→b between signed offsets o0 < o1 (positive = left of travel), CCW.
 * Returns false for a degenerate segment.
 */
export function pushBand(s: TriSoup, a: Vec2, b: Vec2, o0: number, o1: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9 || o1 <= o0) return false;
  const nx = -dy / len;
  const ny = dx / len;
  pushQuad(
    s,
    { x: a.x + nx * o0, y: a.y + ny * o0 },
    { x: b.x + nx * o0, y: b.y + ny * o0 },
    { x: b.x + nx * o1, y: b.y + ny * o1 },
    { x: a.x + nx * o1, y: a.y + ny * o1 },
  );
  return true;
}

/** CCW triangle fan disc. */
export function pushDisc(s: TriSoup, c: Vec2, r: number, segments: number): void {
  if (r <= 0) return;
  const i0 = s.positions.length / 2;
  s.positions.push(c.x, c.y);
  for (let k = 0; k < segments; k++) {
    const t = (2 * Math.PI * k) / segments;
    s.positions.push(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
  }
  for (let k = 0; k < segments; k++) s.indices.push(i0, i0 + 1 + k, i0 + 1 + ((k + 1) % segments));
}

/** CCW circular sector from angle t0 to t1 (> t0, rad), arc split into ceil(span / step) chords. */
export function pushSector(s: TriSoup, c: Vec2, r: number, t0: number, t1: number, step: number): void {
  if (r <= 0 || t1 <= t0) return;
  const n = Math.max(1, Math.ceil((t1 - t0) / step - 1e-9));
  const i0 = s.positions.length / 2;
  s.positions.push(c.x, c.y);
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    s.positions.push(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
  }
  for (let k = 0; k < n; k++) s.indices.push(i0, i0 + 1 + k, i0 + 2 + k);
}

/**
 * Strip of `width` m just inside a polygon ring (an outline, e.g. a court's painted border).
 * The ring may be in either orientation; vertices are mitred (limited to 2 × width).
 */
export function ringOutline(ring: readonly Vec2[], width: number): TriSoup {
  const s = emptySoup();
  const n = ring.length;
  if (n < 3 || width <= 0) return s;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % n] as Vec2;
    area2 += a.x * b.y - b.x * a.y;
  }
  const pts = area2 >= 0 ? [...ring] : [...ring].reverse(); // CCW: interior on the left
  const inner: Vec2[] = pts.map((p, i) => {
    const prev = pts[(i + n - 1) % n] as Vec2;
    const next = pts[(i + 1) % n] as Vec2;
    const l0 = Math.hypot(p.x - prev.x, p.y - prev.y) || 1;
    const l1 = Math.hypot(next.x - p.x, next.y - p.y) || 1;
    const n0 = { x: -(p.y - prev.y) / l0, y: (p.x - prev.x) / l0 };
    const n1 = { x: -(next.y - p.y) / l1, y: (next.x - p.x) / l1 };
    let mx = n0.x + n1.x;
    let my = n0.y + n1.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) return { x: p.x + n0.x * width, y: p.y + n0.y * width };
    mx /= ml;
    my /= ml;
    const k = Math.min(width / Math.max(mx * n0.x + my * n0.y, 1e-9), 2 * width);
    return { x: p.x + mx * k, y: p.y + my * k };
  });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(s, pts[i] as Vec2, pts[j] as Vec2, inner[j] as Vec2, inner[i] as Vec2);
  }
  return s;
}

export function buildStreetSurfaces(graph: GraphSnapshot, opts: Partial<SurfaceOptions> = {}): StreetSurfaces {
  const o: SurfaceOptions = { ...DEFAULT_SURFACE, ...opts };
  const out: StreetSurfaces = {
    sidewalk: emptySoup(),
    carriageway: { alley: emptySoup(), local: emptySoup(), collector: emptySoup(), avenue: emptySoup() },
    centerSolid: emptySoup(),
    centerDashed: emptySoup(),
  };
  const streets = graph.edges.filter((e) => e.cls !== 'frame');
  const incident = new Map<number, typeof streets>();
  for (const e of streets) {
    for (const n of [e.a, e.b]) {
      const list = incident.get(n);
      if (list) list.push(e);
      else incident.set(n, [e]);
    }
  }
  const node = (id: number): Vec2 => graph.nodes[id] as Vec2;

  for (const e of streets) {
    const cls = e.cls as StreetClass;
    const a = node(e.a);
    const b = node(e.b);
    const h = e.width / 2;
    pushBand(out.carriageway[cls], a, b, -h, h);
    if (e.sidewalk > 0) {
      pushBand(out.sidewalk, a, b, h, h + e.sidewalk);
      pushBand(out.sidewalk, a, b, -h - e.sidewalk, -h);
    }
    if (cls !== 'avenue' && cls !== 'collector') continue;
    // Trim the centre line where a wider-class street crosses or meets this one.
    const trim = (n: number): number => {
      let t = 0;
      for (const f of incident.get(n) ?? []) {
        if (RANK[f.cls as StreetClass] > RANK[cls]) t = Math.max(t, f.width / 2);
      }
      return t;
    };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t0 = trim(e.a);
    const t1 = len - trim(e.b);
    if (t1 - t0 <= 0) continue;
    const at = (t: number): Vec2 => ({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
    const hw = o.lineWidth / 2;
    if (cls === 'avenue') {
      pushBand(out.centerSolid, at(t0), at(t1), -hw, hw);
    } else {
      for (let t = t0; t < t1; t += o.dash + o.gap) pushBand(out.centerDashed, at(t), at(Math.min(t + o.dash, t1)), -hw, hw);
    }
  }

  for (const [id, list] of incident) {
    const c = node(id);
    let top = list[0] as (typeof list)[number];
    let walk = 0;
    for (const e of list) {
      const r = RANK[e.cls as StreetClass];
      const rt = RANK[top.cls as StreetClass];
      if (r > rt || (r === rt && e.width > top.width)) top = e;
      if (e.sidewalk > 0) walk = Math.max(walk, e.width / 2 + e.sidewalk);
    }
    const lane = out.carriageway[top.cls as StreetClass];
    const angles = list
      .map((e) => {
        const q = node(e.a === id ? e.b : e.a);
        return Math.atan2(q.y - c.y, q.x - c.x);
      })
      .sort((p, q) => p - q);
    for (let i = 0; i < angles.length; i++) {
      const from = angles[i] as number;
      const to = i + 1 < angles.length ? (angles[i + 1] as number) : (angles[0] as number) + 2 * Math.PI;
      if (to - from <= Math.PI + o.straightTurn) continue; // the two bands overlap on this side
      // Left band edge of the arm at `from` is at from + 90°, right edge of the next arm at to - 90°.
      pushSector(out.sidewalk, c, walk, from + Math.PI / 2, to - Math.PI / 2, o.arcStep);
      pushSector(lane, c, top.width / 2, from + Math.PI / 2, to - Math.PI / 2, o.arcStep);
    }
    if (list.length >= 3) {
      pushDisc(out.sidewalk, c, walk, o.discSegments);
      pushDisc(lane, c, top.width / 2, o.discSegments);
    }
  }
  return out;
}
