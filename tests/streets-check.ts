/**
 * Brute-force (O(n²)) validators for street graphs, independent of the generator's spatial index.
 * Not a test file itself: imported by tests/streets-*.test.ts.
 */
import type { GraphSnapshot } from '../src/world/streets/planar-graph.ts';
import type { Vec2 } from '../src/world/vec.ts';

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Segments ab and cd intersect (crossing or touching), ignoring shared endpoints. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  if (d1 === 0 && on(c, d, a)) return true;
  if (d2 === 0 && on(c, d, b)) return true;
  if (d3 === 0 && on(a, b, c)) return true;
  if (d4 === 0 && on(a, b, d)) return true;
  return false;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  const tc = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p.x - a.x - dx * tc, p.y - a.y - dy * tc), t };
}

export interface PlanarityReport {
  crossings: string[];
  closeNodes: string[];
  nodeNearEdge: string[];
  shortEdges: string[];
}

/**
 * - crossings: two edges that intersect without sharing a node;
 * - closeNodes: two nodes closer than `snap`;
 * - nodeNearEdge: a node within `snap` / 2 of the interior of an edge it does not belong to;
 * - shortEdges: street edges (not frame) shorter than minLength (minAlley for alleys).
 */
export function checkPlanarity(g: GraphSnapshot, snap = 1, minLength = 8, minAlley = 3): PlanarityReport {
  const P = (id: number) => g.nodes[id] as Vec2;
  const r: PlanarityReport = { crossings: [], closeNodes: [], nodeNearEdge: [], shortEdges: [] };
  const E = g.edges;
  for (let i = 0; i < E.length; i++) {
    const e = E[i]!;
    const a = P(e.a);
    const b = P(e.b);
    for (let j = i + 1; j < E.length; j++) {
      const f = E[j]!;
      if (f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b) continue;
      const c = P(f.a);
      const d = P(f.b);
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) continue;
      if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
      if (segmentsIntersect(a, b, c, d)) r.crossings.push(`edge ${e.id} (${e.cls}) x edge ${f.id} (${f.cls})`);
    }
    if (e.cls !== 'frame') {
      const min = e.cls === 'alley' ? minAlley : minLength;
      if (e.length < min) r.shortEdges.push(`edge ${e.id} (${e.cls}) ${e.length.toFixed(2)} m`);
    }
  }
  const N = g.nodes;
  for (let i = 0; i < N.length; i++) {
    for (let j = i + 1; j < N.length; j++) {
      const d = Math.hypot(N[i]!.x - N[j]!.x, N[i]!.y - N[j]!.y);
      if (d < snap) r.closeNodes.push(`nodes ${i},${j} ${d.toFixed(3)} m`);
    }
    for (const e of E) {
      if (e.a === i || e.b === i) continue;
      const pr = pointSegmentDistance(N[i]!, P(e.a), P(e.b));
      if (pr.t > 0 && pr.t < 1 && pr.d < snap / 2) r.nodeNearEdge.push(`node ${i} ${pr.d.toFixed(3)} m from edge ${e.id}`);
    }
  }
  return r;
}

/** Street components (frames excluded) as arrays of edge ids. */
export function streetComponents(g: GraphSnapshot): number[][] {
  const parent = g.nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const streets = g.edges.filter((e) => e.cls !== 'frame');
  for (const e of streets) parent[find(e.a)] = find(e.b);
  const comps = new Map<number, number[]>();
  for (const e of streets) {
    const r = find(e.a);
    const l = comps.get(r);
    if (l) l.push(e.id);
    else comps.set(r, [e.id]);
  }
  return [...comps.values()];
}

/** Realism band of street-metrics.yaml (band.default + band.overrides[name]). */
export type RealismBand = {
  block_area_median_rel: number;
  block_area_p90_rel: number;
  node_share_abs: number;
  intersections_per_km2_rel: number;
  street_km_per_km2_rel: number;
};
export type MetricsFile = {
  references: Record<string, { metrics: Record<string, number> }>;
  band: { default: RealismBand; overrides?: Record<string, Partial<RealismBand>> };
};

/** Band violations of metrics `m` against frozen reference `name` (empty = inside the band). */
export function bandViolations(m: Record<string, number>, name: string, file: MetricsFile): string[] {
  const ref = file.references[name]?.metrics;
  if (!ref) return [`no frozen reference "${name}" in street-metrics.yaml`];
  const band: RealismBand = { ...file.band.default, ...(file.band.overrides?.[name] ?? {}) };
  const out: string[] = [];
  const rel = (k: string, tol: number) => {
    const d = Math.abs((m[k] as number) - (ref[k] as number)) / (ref[k] as number);
    if (!(d <= tol)) out.push(`${k}: ${(m[k] as number).toFixed(3)} vs ${(ref[k] as number).toFixed(3)} (±${tol * 100}%, off by ${(d * 100).toFixed(1)}%)`);
  };
  rel('block_area_median_m2', band.block_area_median_rel);
  rel('block_area_p90_m2', band.block_area_p90_rel);
  rel('intersections_per_km2', band.intersections_per_km2_rel);
  rel('street_km_per_km2', band.street_km_per_km2_rel);
  for (const k of ['dead_end_share', 't_share', 'x_share']) {
    const d = Math.abs((m[k] as number) - (ref[k] as number));
    if (!(d <= band.node_share_abs)) out.push(`${k}: ${(m[k] as number).toFixed(3)} vs ${(ref[k] as number).toFixed(3)} (±${band.node_share_abs * 100} pts)`);
  }
  return out;
}

/**
 * Street dead ends (street degree 1) that stop inside another street without a junction: the end
 * lies within other.width/2 + other.sidewalk + stub.width/2 (+ margin) of that street's centreline
 * (the stub's carriageway reaches its sidewalk), or within `junctionSnap` of one of its nodes.
 * Edges sharing a node with the stub (its own continuation) are not counted. Brute force.
 */
export function penetratingDeadEnds(g: GraphSnapshot, margin = 0, junctionSnap = 3): string[] {
  const P = (id: number) => g.nodes[id] as Vec2;
  const streets = g.edges.filter((e) => e.cls !== 'frame');
  const deg = new Array<number>(g.nodes.length).fill(0);
  for (const e of streets) {
    deg[e.a]!++;
    deg[e.b]!++;
  }
  const out: string[] = [];
  for (const n of g.nodes) {
    if (deg[n.id] !== 1) continue;
    const stub = streets.find((e) => e.a === n.id || e.b === n.id)!;
    const keep = stub.a === n.id ? stub.b : stub.a;
    for (const e of streets) {
      if (e.id === stub.id || e.a === n.id || e.b === n.id || e.a === keep || e.b === keep) continue;
      const d = pointSegmentDistance(n, P(e.a), P(e.b)).d;
      const reach = e.width / 2 + e.sidewalk + stub.width / 2 + margin;
      const nodeD = Math.min(Math.hypot(P(e.a).x - n.x, P(e.a).y - n.y), Math.hypot(P(e.b).x - n.x, P(e.b).y - n.y));
      if (d < reach || nodeD <= junctionSnap) {
        out.push(`dead end ${n.id} (${n.x.toFixed(1)},${n.y.toFixed(1)}) of ${stub.cls} edge ${stub.id} is ${d.toFixed(2)} m from ${e.cls} edge ${e.id} (reach ${reach.toFixed(2)} m)`);
        break;
      }
    }
  }
  return out;
}

/**
 * Walk islands: walkable street components (streets with sidewalk, and alleys) holding no walkable
 * fixed edge, i.e. reachable only across a street without sidewalk. Returns their edge ids.
 */
export function walkIslands(g: GraphSnapshot): number[][] {
  const parent = g.nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const walk = g.edges.filter((e) => e.cls !== 'frame' && (e.sidewalk > 0 || e.cls === 'alley'));
  for (const e of walk) parent[find(e.a)] = find(e.b);
  const comps = new Map<number, { ids: number[]; anchored: boolean }>();
  for (const e of walk) {
    const r = find(e.a);
    const c = comps.get(r) ?? { ids: [], anchored: false };
    c.ids.push(e.id);
    c.anchored ||= e.fixed;
    comps.set(r, c);
  }
  return [...comps.values()].filter((c) => !c.anchored).map((c) => c.ids);
}
