/**
 * Section generator: a closed region -> a walled neighbourhood whose numbers come from a section
 * profile. Boundary road along the (smooth) outline, 0..max openings (ports) plus the avenues that
 * cross it, then the inner network (network.ts). The faces / blocks / buildable / parcels / buildings /
 * walk-graph steps that follow are the existing ones, unchanged.
 */
import type { Vec2 } from '../../vec.ts';
import type { Rng } from '../../rng.ts';
import { pointInPolygon } from '../../geometry.ts';
import type { SectionProfile } from '../../spec.ts';
import type { EdgeProps, StreetClass } from '../planar-graph.ts';
import { PlanarGraph, segmentIntersection } from '../planar-graph.ts';
import type { SectionPort } from './ports.ts';
import { addDeadEnds, alignJogs, splitFaces, type LayerContext } from './network.ts';
import { normalQuantile, sectionParams } from './params.ts';
import { ringAreaSigned as ringArea } from './outline.ts';
import * as D from './dmath.ts';

export interface SectionInfo {
  id: string;
  district: string;
  /** Boundary road centreline, counter-clockwise. */
  outline: Vec2[];
  /** Every street end crossing the boundary: avenues passing through first, then the chosen openings. */
  ports: SectionPort[];
  stats: { streetCuts: number; deadEnds: number; alleyCuts: number };
}

export class SectionError extends Error {}

export interface SectionInput {
  profile: SectionProfile;
  graph: PlanarGraph;
  outline: Vec2[];
  /** street_styles.hierarchy: width / sidewalk per generated class. */
  hierarchy: Record<string, { width: number; sidewalk: number }>;
  rng: Rng;
}

const ALLEY = 'alley';
/** Safety bound on subdivision rounds (a round at least halves the largest face; 24 covers 1e7 x). */
const MAX_ROUNDS = 24;

/** Crossings of the fixed (avenue) edges with the outline, as through ports. */
function throughPorts(graph: PlanarGraph, outline: readonly Vec2[]): SectionPort[] {
  const out: SectionPort[] = [];
  for (const e of graph.edges()) {
    if (!e.fixed || e.cls === 'frame') continue;
    const A = graph.node(e.a);
    const B = graph.node(e.b);
    for (let i = 0; i < outline.length; i++) {
      const hit = segmentIntersection(A, B, outline[i] as Vec2, outline[(i + 1) % outline.length] as Vec2);
      if (!hit) continue;
      const X = { x: A.x + (B.x - A.x) * hit.t, y: A.y + (B.y - A.y) * hit.t };
      const outwardIsB = !pointInPolygon(B, outline);
      const d = outwardIsB ? { x: B.x - A.x, y: B.y - A.y } : { x: A.x - B.x, y: A.y - B.y };
      out.push({ at: X, crossing: X, heading: D.atan2(d.y, d.x), cls: e.cls, width: e.width, through: true });
    }
  }
  return out;
}

export function generateSection(input: SectionInput): SectionInfo {
  const { profile, graph, outline, hierarchy, rng } = input;
  const p = sectionParams(profile);
  const district = profile.district;
  const propsOf = (cls: string): EdgeProps => {
    const h = hierarchy[cls];
    if (!h) throw new SectionError(`section ${profile.id}: street class ${cls} is not in street_styles.hierarchy`);
    return { cls: cls as StreetClass, width: h.width, sidewalk: h.sidewalk, fixed: false, district };
  };
  const boundaryProps = propsOf(p.boundaryClass);
  if (Math.abs(boundaryProps.width - p.portWidth) > 0.5) {
    throw new SectionError(`section ${profile.id}: ports.width_m ${p.portWidth} does not match the ${p.boundaryClass} carriageway ${boundaryProps.width}`);
  }

  // 1. Avenues crossing the boundary are openings already (fixed), counted against the profile's maximum.
  const through = throughPorts(graph, outline);
  if (through.length > p.openings.max) {
    throw new SectionError(`section ${profile.id}: ${through.length} fixed routes cross the boundary, the profile allows ${p.openings.max} openings`);
  }

  // 2. Boundary road.
  graph.addPolyline([...outline, outline[0] as Vec2], boundaryProps);

  // 3. Chosen openings: 0..max minus the avenues, positions drawn on the boundary.
  const portRng = rng.fork('ports');
  const lo = Math.max(0, p.openings.min - through.length);
  const hi = Math.max(0, p.openings.max - through.length);
  const countU = portRng.next();
  const want = lo + Math.floor(countU * (hi - lo + 1));
  const attempts = Array.from({ length: 8 * Math.max(1, p.openings.max) }, () => portRng.next());
  const ports: SectionPort[] = [...through];
  const lc: LayerContext = { graph, outline, district, params: p, props: propsOf };
  const minAngle = (p.minAngleP10 * Math.PI) / 180;
  let chosen = 0;
  const perimeter = ringLength(outline);
  for (const u of attempts) {
    if (chosen >= want) continue;
    const at = pointAt(outline, u * perimeter);
    if (ports.some((q) => Math.hypot(q.crossing.x - at.pt.x, q.crossing.y - at.pt.y) < p.segment.p90)) continue;
    const seg = segAt(outline, at.seg);
    const inward = D.atan2(seg.x, -seg.y);
    // The opening runs along the family direction nearest to the inward normal.
    let best = p.directions[0] as number;
    for (const d of p.directions) if (angDiff(d, inward) < angDiff(best, inward)) best = d;
    const dir = D.cos(best - inward) >= 0 ? best : best + Math.PI;
    const d = { x: D.cos(dir), y: D.sin(dir) };
    const cross = D.acos(Math.min(1, Math.abs(d.x * seg.ux + d.y * seg.uy)));
    if (cross < minAngle) continue;
    const far = firstExit(outline, at.pt, d);
    if (!far || Math.hypot(far.x - at.pt.x, far.y - at.pt.y) < p.segment.p50) continue;
    const tip = { x: at.pt.x - d.x * p.segment.p10, y: at.pt.y - d.y * p.segment.p10 };
    graph.addPolyline([tip, at.pt, far], boundaryProps);
    ports.push({ at: tip, crossing: at.pt, heading: D.atan2(-d.y, -d.x), cls: boundaryProps.cls, width: boundaryProps.width, through: false });
    chosen++;
  }
  if (chosen < want) throw new SectionError(`section ${profile.id}: could place only ${chosen} of ${want} openings`);

  // 4. Street layer: faces down to the size the measured junction density implies.
  const meanFace = 1e6 / (p.intersectionsPerKm2 * p.facesPerNode);
  const sigma = p.block.sigma;
  const segSigma = D.log(p.segment.p90 / p.segment.p10) / (2 * normalQuantile(0.9));
  // Junction budget: the measured density x area, less what the dead ends will add (each spur adds a dead end and a T).
  const areaKm2 = Math.abs(ringArea(outline)) / 1e6;
  const budget = p.intersectionsPerKm2 * areaKm2;
  const streetCuts = splitFaces(lc, {
    maxJunctions: Math.floor(budget * (1 - 2 * p.mix.deadEnd)),
    // Street km budget; every junction node will bring d / (1 - 2d) dead-end spurs, each about one mean segment long.
    maxLength: p.streetKmPerKm2 * areaKm2 * 1000,
    reservePerJunction: (p.mix.deadEnd / (1 - 2 * p.mix.deadEnd)) * p.segment.p50 * D.exp((segSigma * segSigma) / 2),
    cls: p.boundaryClass,
    median: meanFace / D.exp((sigma * sigma) / 2),
    sigma,
    junctionMix: true,
    rng: rng.fork('streets'),
    maxRounds: MAX_ROUNDS,
  });
  alignJogs(lc);
  // 5. Dead ends up to the measured share.
  const deadEnds = addDeadEnds(lc, rng.fork('deadends'));
  // 6. Alley layer: faces down to the measured block band.
  const alleyCuts = splitFaces(lc, { cls: ALLEY, median: p.block.p50, sigma, junctionMix: false, rng: rng.fork('alleys'), maxRounds: MAX_ROUNDS });

  return { id: profile.id, district, outline, ports, stats: { streetCuts, deadEnds, alleyCuts } };
}

// ------------------------------------------------------------------ ring helpers

const ringLength = (r: readonly Vec2[]): number => r.reduce((s, a, i) => s + Math.hypot((r[(i + 1) % r.length] as Vec2).x - a.x, (r[(i + 1) % r.length] as Vec2).y - a.y), 0);

function pointAt(r: readonly Vec2[], s: number): { pt: Vec2; seg: number } {
  let acc = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i] as Vec2;
    const b = r[(i + 1) % r.length] as Vec2;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + l >= s) {
      const t = (s - acc) / l;
      return { pt: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, seg: i };
    }
    acc += l;
  }
  return { pt: r[0] as Vec2, seg: 0 };
}

function segAt(r: readonly Vec2[], i: number): { x: number; y: number; ux: number; uy: number } {
  const a = r[i] as Vec2;
  const b = r[(i + 1) % r.length] as Vec2;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l, ux: (b.x - a.x) / l, uy: (b.y - a.y) / l };
}

/** Angle between two directions (radians, 0..pi). */
function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** First point where the ray from o (just inside the ring) along d leaves the ring. */
function firstExit(ring: readonly Vec2[], o: Vec2, d: Vec2): Vec2 | undefined {
  let best: { t: number; pt: Vec2 } | undefined;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % ring.length] as Vec2;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (t > 1 && u >= 0 && u < 1 && (!best || t < best.t)) best = { t, pt: { x: a.x + ex * u, y: a.y + ey * u } };
  }
  return best?.pt;
}
