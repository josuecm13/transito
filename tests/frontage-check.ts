/**
 * Measures the "building fingerprint" of a generated district the way the geospatial engine
 * measures a real block (generation/fingerprint.py): sample the street frontage every ~1 m, cast a
 * ray inward (up to 25 m) and take the first building it reaches. Written independently of
 * src/world/streets/frontage-lots.ts (own frontage detection against the street graph, own ray
 * cast) so the tests do not grade the generator with its own code. Not a test file itself.
 *
 *   coverage  = samples that hit a building / all samples
 *   width     = per building, length of frontage its rays cover (m)
 *   depth     = the building's own depth (m)
 *   setback   = per building, median ray distance from the buildable line to its front (m)
 *   sideGap   = between two buildings hit consecutively on one edge (front row only, rays up to
 *               6 m), the miss run between them (m); 0 when they touch
 */
import type { GraphSnapshot } from '../src/world/streets/planar-graph.ts';
import type { City } from '../src/world/streets/index.ts';
import { buildingCorners } from '../src/world/blockout.ts';
import { pointInPolygon } from '../src/world/geometry.ts';
import type { Vec2 } from '../src/world/vec.ts';
import { pointSegmentDistance } from './streets-check.ts';

const RAY = 25;
/** Side gaps look only at the front row: a ray through a gap that reaches a building 6 m+ away is a miss. */
const FRONT_ROW = 6;
const SAMPLE = 1;
const FRONT_TOL = 0.3;
const MARGIN = 0.05;

export interface FrontageFingerprint {
  samples: number;
  coverage: number;
  width: number;
  depth: number;
  setback: number;
  sideGap: number;
  buildings: number;
}

export const median = (v: readonly number[]): number => {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Distance along the ray from o in direction d to segment ab, or Infinity. */
function rayHit(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
  const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

export function measureFrontage(city: City, graph: GraphSnapshot, district: string, opts: { sample?: number } = {}): FrontageFingerprint {
  const step = opts.sample ?? SAMPLE;
  const streets = graph.edges
    .filter((e) => e.cls !== 'frame')
    .map((e) => ({ a: graph.nodes[e.a] as Vec2, b: graph.nodes[e.b] as Vec2, r: e.width / 2 + e.sidewalk + MARGIN }));
  const bySide = new Map<number, Vec2[]>();
  const indexOf = new Map<number, number[]>();
  city.buildings.forEach((b, i) => {
    if (b.district !== district) return;
    const l = indexOf.get(b.block) ?? [];
    l.push(i);
    indexOf.set(b.block, l);
    bySide.set(i, buildingCorners(b));
  });
  let samples = 0;
  let hits = 0;
  const dists = new Map<number, number[]>();
  const widths = new Map<number, number>();
  const gaps: number[] = [];
  for (const area of city.buildable) {
    const blockBuildings = indexOf.get(area.block);
    if (city.landUse[area.block]?.district !== district) continue;
    const use = city.landUse[area.block]?.use;
    if (use !== 'residential' && use !== 'commercial') continue;
    for (const part of area.parts) {
      const ring = part.outer;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as Vec2;
        const b = ring[(i + 1) % ring.length] as Vec2;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.5) continue;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const fronts = streets.some((s) => {
          const sl = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
          if (sl === 0) return false;
          if (Math.abs(ux * (s.b.y - s.a.y) - uy * (s.b.x - s.a.x)) / sl > Math.sin((15 * Math.PI) / 180)) return false;
          return Math.abs(pointSegmentDistance(m, s.a, s.b).d - s.r) <= FRONT_TOL;
        });
        if (!fronts) continue;
        let n = { x: -uy, y: ux };
        if (!pointInPolygon({ x: m.x + n.x * 0.1, y: m.y + n.y * 0.1 }, part.outer)) n = { x: -n.x, y: -n.y };
        const count = Math.max(1, Math.round(len / step));
        const spacing = len / count;
        let prev: number | null | undefined;
        let miss = 0;
        let seenHit = false;
        for (let k = 0; k < count; k++) {
          const o = { x: a.x + ux * (k + 0.5) * spacing, y: a.y + uy * (k + 0.5) * spacing };
          let best: { i: number; t: number } | undefined;
          for (const bi of blockBuildings ?? []) {
            const c = bySide.get(bi) as Vec2[];
            for (let q = 0; q < 4; q++) {
              const t = rayHit(o, n, c[q] as Vec2, c[(q + 1) % 4] as Vec2);
              if (t <= RAY && (!best || t < best.t)) best = { i: bi, t };
            }
          }
          samples++;
          if (best) {
            hits++;
            dists.set(best.i, [...(dists.get(best.i) ?? []), best.t]);
            widths.set(best.i, (widths.get(best.i) ?? 0) + spacing);
          }
          if (best && best.t <= FRONT_ROW) {
            if (prev !== undefined && prev !== null && prev !== best.i) gaps.push(0);
            else if (prev === null && seenHit) gaps.push(miss * spacing);
            prev = best.i;
            miss = 0;
            seenHit = true;
          } else {
            if (prev !== null && seenHit) miss = 0;
            prev = null;
            miss++;
          }
        }
      }
    }
  }
  const ids = [...widths.keys()];
  return {
    samples,
    coverage: samples === 0 ? NaN : hits / samples,
    width: median(ids.map((i) => widths.get(i) as number)),
    depth: median(ids.map((i) => (city.buildings[i] as { depth: number }).depth)),
    setback: median(ids.map((i) => median(dists.get(i) as number[]))),
    sideGap: median(gaps),
    buildings: ids.length,
  };
}
