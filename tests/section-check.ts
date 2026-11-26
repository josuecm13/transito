// Shared by tests/section-generate.test.ts and the scout renderer: the profile's measures taken on a generated section,
// with the same definitions the sample was measured with (corners: Douglas-Peucker 3 m, turns < 25 deg dropped).
import { pointInPolygon } from '../src/world/geometry.ts';
import type { Vec2 } from '../src/world/vec.ts';
import { percentileCont } from '../src/world/street-metrics.ts';
import { minAreaObb } from '../src/world/streets/poly.ts';
import type { Block } from '../src/world/streets/faces.ts';
import { buildBlocks } from '../src/world/streets/faces.ts';
import type { GraphSnapshot } from '../src/world/streets/planar-graph.ts';
import { ringAreaSigned } from '../src/world/streets/section/outline.ts';

export const inOrOn = (outline: readonly Vec2[], p: Vec2, tol = 1.5): boolean => {
  if (pointInPolygon(p, outline)) return true;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Vec2;
    const b = outline[(i + 1) % outline.length] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= tol) return true;
  }
  return false;
};

const q = (xs: number[], p: number): number => percentileCont([...xs].sort((a, b) => a - b), p);

function dp(pts: readonly Vec2[], tol: number): Vec2[] {
  const dist = (p: Vec2, a: Vec2, b: Vec2): number => {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return l === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
  };
  const rec = (ps: readonly Vec2[]): Vec2[] => {
    if (ps.length < 3) return [...ps];
    let im = 1;
    let dm = -1;
    for (let i = 1; i < ps.length - 1; i++) {
      const d = dist(ps[i] as Vec2, ps[0] as Vec2, ps[ps.length - 1] as Vec2);
      if (d > dm) {
        dm = d;
        im = i;
      }
    }
    if (dm > tol) return [...rec(ps.slice(0, im + 1)).slice(0, -1), ...rec(ps.slice(im))];
    return [ps[0] as Vec2, ps[ps.length - 1] as Vec2];
  };
  let k = 0;
  let kd = -1;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - (pts[0] as Vec2).x, p.y - (pts[0] as Vec2).y);
    if (d > kd) {
      kd = d;
      k = i;
    }
  });
  return [...rec(pts.slice(0, k + 1)).slice(0, -1), ...rec([...pts.slice(k), pts[0] as Vec2]).slice(0, -1)];
}

/** Corner polygon of a block ring: DP 3 m, then vertices turning less than 25 deg are removed. */
export function corners(ring: readonly Vec2[], tol = 3, minTurnDeg = 25): Vec2[] {
  const s = dp(ring, tol);
  const turn = (a: Vec2, b: Vec2, c: Vec2): number => {
    const t = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    const d = t % (2 * Math.PI);
    return ((d > Math.PI ? 2 * Math.PI - d : d) * 180) / Math.PI;
  };
  for (let again = true; again && s.length > 3; ) {
    again = false;
    for (let i = 0; i < s.length; i++) {
      if (turn(s[(i + s.length - 1) % s.length] as Vec2, s[i] as Vec2, s[(i + 1) % s.length] as Vec2) < minTurnDeg) {
        s.splice(i, 1);
        again = true;
        break;
      }
    }
  }
  return s;
}

export interface Dist3 {
  p10: number;
  p50: number;
  p90: number;
  n: number;
}
const dist3 = (xs: number[]): Dist3 => ({ p10: q(xs, 0.1), p50: q(xs, 0.5), p90: q(xs, 0.9), n: xs.length });

export interface SectionMeasure {
  areaKm2: number;
  /** Blocks of the final graph (streets + alleys): what buildings fill. */
  blocks: { area: Dist3; elongationP50: number; sidesP50: number; n: number };
  /** Faces of the mapped streets only (alleys removed), the way the reference blocks were polygonised. */
  streetFaces: { area: Dist3; n: number };
  /** Mapped streets only (alleys excluded), clipped to the section: the reference's definitions. */
  network: {
    streetKmPerKm2: number;
    intersectionsPerKm2: number;
    deadEnd: number;
    t: number;
    x: number;
    junctions: number;
    segmentP50: number;
    segmentEdgesP50: number;
  };
}

/** Measures one section: `outline` is its boundary road, `isInside` the playable-land test used to keep faces. */
export function measureSection(graph: GraphSnapshot, blocks: readonly Block[], outline: readonly Vec2[], isInside: (p: Vec2) => boolean): SectionMeasure {
  const areaKm2 = ringAreaSigned(outline) / 1e6;
  const mine = blocks.filter((b) => pointInPolygon(b.interior, outline) && !b.isMedian && b.frameKinds.length === 0);
  const elong = mine.map((b) => {
    const o = minAreaObb(b.ring);
    return o.short > 0 ? o.long / o.short : 1;
  });
  const sides = mine.map((b) => corners(b.ring).length);

  // Street-only faces.
  const noAlley: GraphSnapshot = { nodes: graph.nodes, edges: graph.edges.filter((e) => e.cls !== 'alley').map((e, i) => ({ ...e, id: i })) };
  const faces = buildBlocks(noAlley, { isInside, districtOf: (p) => (pointInPolygon(p, outline) ? 'section' : undefined) }).filter(
    (b) => b.district === 'section' && !b.isMedian && b.frameKinds.length === 0,
  );

  // Network of mapped streets inside the outline.
  const street = noAlley.edges.filter((e) => {
    if (e.cls === 'frame') return false;
    const a = noAlley.nodes[e.a] as Vec2;
    const b = noAlley.nodes[e.b] as Vec2;
    return inOrOn(outline, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
  const deg = new Map<number, number>();
  for (const e of street) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  let de = 0;
  let t = 0;
  let x = 0;
  for (const [, d] of deg) {
    if (d === 1) de++;
    else if (d === 3) t++;
    else if (d >= 4) x++;
  }
  const junctions = de + t + x;
  const km = street.reduce((s, e) => s + e.length, 0) / 1000;
  // Segment length between junctions: chain the degree-2 joints.
  const adj = new Map<number, typeof street>();
  for (const e of street) for (const n of [e.a, e.b]) adj.set(n, [...(adj.get(n) ?? []), e]);
  const seen = new Set<number>();
  const chains: number[] = [];
  for (const e0 of street) {
    if (seen.has(e0.id)) continue;
    let len = 0;
    const walk = (start: number, e: (typeof street)[number]): void => {
      let cur = e;
      let at = start;
      for (let guard = 0; guard < 10000; guard++) {
        if (seen.has(cur.id)) return;
        seen.add(cur.id);
        len += cur.length;
        at = cur.a === at ? cur.b : cur.a;
        if ((deg.get(at) ?? 0) !== 2) return;
        const next = (adj.get(at) ?? []).find((f) => f.id !== cur.id);
        if (!next) return;
        cur = next;
      }
    };
    // Extend both directions from e0.
    seen.add(e0.id);
    len = e0.length;
    for (const end of [e0.a, e0.b]) {
      let cur = e0;
      let at = end;
      for (let guard = 0; guard < 10000 && (deg.get(at) ?? 0) === 2; guard++) {
        const next = (adj.get(at) ?? []).find((f) => f.id !== cur.id);
        if (!next || seen.has(next.id)) break;
        seen.add(next.id);
        len += next.length;
        at = next.a === at ? next.b : next.a;
        cur = next;
      }
    }
    void walk;
    chains.push(len);
  }
  return {
    areaKm2,
    blocks: { area: dist3(mine.map((b) => b.area)), elongationP50: q(elong, 0.5), sidesP50: q(sides, 0.5), n: mine.length },
    streetFaces: { area: dist3(faces.map((b) => b.area)), n: faces.length },
    network: {
      streetKmPerKm2: km / areaKm2,
      intersectionsPerKm2: junctions / areaKm2,
      deadEnd: junctions ? de / junctions : 0,
      t: junctions ? t / junctions : 0,
      x: junctions ? x / junctions : 0,
      junctions,
      segmentP50: q(chains, 0.5),
      segmentEdgesP50: q(street.map((e) => e.length), 0.5),
    },
  };
}
