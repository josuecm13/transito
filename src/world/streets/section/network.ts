/**
 * Inner network of a section, grown from the profile by recursive subdivision of the faces of the
 * planar graph: boundary road (+ avenues crossing it) -> openings -> street layer (faces down to the
 * face size the measured junction density implies) -> dead ends (to the measured junction mix) ->
 * alley layer (faces down to the measured block-area band).
 *
 * Why two layers: the reference counts only mapped streets (the engine imports no footways or
 * paths), and for fully tessellated land its intersections/km2, junction mix and street km/km2
 * imply faces about 3x larger than its eligible-block median (Euler: faces per junction node =
 * sum(share * degree) / 2 - 1). The street layer honours the density figures, the alley layer (class
 * alley, which every metric of this repo already measures as absent, see measure.ts excludeClasses)
 * completes the fabric down to the block band, as the engine's unmapped lanes do in the real sample.
 *
 * Determinism: one forked rng per phase; every face visit draws the same number of values whatever
 * the outcome of the rules.
 */
import type { Vec2 } from '../../vec.ts';
import type { Rng } from '../../rng.ts';
import { distanceToSegment, pointInPolygon } from '../../geometry.ts';
import type { EdgeProps, GraphSnapshot } from '../planar-graph.ts';
import { PlanarGraph, segmentIntersection } from '../planar-graph.ts';
import type { Face } from '../faces.ts';
import { extractFaces, interiorPoint } from '../faces.ts';
import { minAreaObb } from '../poly.ts';
import type { SectionParams } from './params.ts';
import { areaQuantile, normalQuantile } from './params.ts';
import * as D from './dmath.ts';

export interface LayerContext {
  graph: PlanarGraph;
  outline: readonly Vec2[];
  district: string;
  params: SectionParams;
  props: (cls: string) => EdgeProps;
}

interface Hit {
  /** Parameter along the line (m from the origin). */
  t: number;
  /** Ring segment index (ring[seg] -> ring[seg + 1]) and fraction along it. */
  seg: number;
  u: number;
  pt: Vec2;
}

const unit = (rad: number): Vec2 => ({ x: D.cos(rad), y: D.sin(rad) });
const angleOf = (v: Vec2): number => D.atan2(v.y, v.x);
const wrapPi = (a: number): number => ((a % Math.PI) + Math.PI) % Math.PI;
/** Smallest difference between two undirected directions (radians, 0..pi/2). */
const lineDiff = (a: number, b: number): number => {
  const d = Math.abs(wrapPi(a) - wrapPi(b));
  return Math.min(d, Math.PI - d);
};
const gauss = (u1: number, u2: number): number => Math.sqrt(-2 * D.log(Math.max(1e-12, u1))) * D.cos(2 * Math.PI * u2);

/** All crossings of the infinite line o + t d with the ring, ascending by t. */
function lineHits(ring: readonly Vec2[], o: Vec2, d: Vec2): Hit[] {
  const hits: Hit[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % n] as Vec2;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (u < 0 || u >= 1) continue;
    hits.push({ t, seg: i, u, pt: { x: a.x + ex * u, y: a.y + ey * u } });
  }
  return hits.sort((p, q) => p.t - q.t || p.seg - q.seg);
}

/**
 * The chord of the polygon along the line through o whose midpoint is nearest to o (inside chords only:
 * consecutive crossings whose midpoint lies in the ring). A concave face has several along one line.
 */
function chordThrough(ring: readonly Vec2[], o: Vec2, d: Vec2): [Hit, Hit] | undefined {
  const hits = lineHits(ring, o, d);
  let best: { c: [Hit, Hit]; off: number } | undefined;
  for (let i = 0; i + 1 < hits.length; i++) {
    const a = hits[i] as Hit;
    const b = hits[i + 1] as Hit;
    if (b.t - a.t < 1e-6) continue;
    const mid = { x: (a.pt.x + b.pt.x) / 2, y: (a.pt.y + b.pt.y) / 2 };
    if (!pointInPolygon(mid, ring)) continue;
    const off = a.t <= 0 && b.t >= 0 ? 0 : Math.min(Math.abs(a.t), Math.abs(b.t));
    if (!best || off < best.off) best = { c: [a, b], off };
  }
  return best?.c;
}

const polyArea = (pts: readonly Vec2[]): number => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j] as Vec2).x * (pts[i] as Vec2).y - (pts[i] as Vec2).x * (pts[j] as Vec2).y;
  return s / 2;
};

/** Acute angle (radians, 0..pi/2) between direction d and ring segment `seg`. */
function crossAngle(ring: readonly Vec2[], seg: number, d: Vec2): number {
  const a = ring[seg] as Vec2;
  const b = ring[(seg + 1) % ring.length] as Vec2;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return D.acos(Math.min(1, Math.abs((d.x * (b.x - a.x) + d.y * (b.y - a.y)) / l)));
}

/**
 * Is p clear of the ring's vertices? A junction vertex (street degree != 2) needs `gap` around it, a
 * mere bend of a street only the graph's snap distance.
 */
/**
 * Which ring vertices need the full `gap` around them: junctions (street degree != 2) and sharp corners of the
 * ring (a turn beyond 90 deg - the least junction angle p10: a street ending near it would pinch against it).
 * A near-straight bend (an avenue's polyline vertex) needs only the snap distance.
 */
function pinch(lc: LayerContext, fv: FaceView, degree: ReadonlyMap<number, number>): boolean[] {
  const ring = fv.ring;
  const n = ring.length;
  const cosLimit = D.cos(Math.PI / 2 - (lc.params.minAngleP10 * Math.PI) / 180);
  return fv.face.ringNodes.map((id, i) => {
    if ((degree.get(id) ?? 0) !== 2) return true;
    const a = ring[(i + n - 1) % n] as Vec2;
    const b = ring[i] as Vec2;
    const c = ring[(i + 1) % n] as Vec2;
    const u = { x: b.x - a.x, y: b.y - a.y };
    const v = { x: c.x - b.x, y: c.y - b.y };
    return (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) < cosLimit;
  });
}

const clearOfVertices = (ring: readonly Vec2[], junction: readonly boolean[], p: Vec2, gap: number, bend: number): boolean =>
  ring.every((q, i) => Math.hypot(q.x - p.x, q.y - p.y) >= (junction[i] ? gap : bend));

export interface JunctionCounts {
  deadEnd: number;
  t: number;
  x: number;
}

/** Junction nodes (street degree != 2) inside the outline, alleys excluded: the measure of the profile's junction mix. */
export function junctionCounts(graph: PlanarGraph, outline: readonly Vec2[]): JunctionCounts {
  const out = { deadEnd: 0, t: 0, x: 0 };
  const street = (e: { cls: string }): boolean => e.cls !== 'frame' && e.cls !== 'alley';
  for (const n of graph.nodes()) {
    const deg = graph.degree(n.id, street);
    if (deg === 0 || deg === 2) continue;
    if (!pointInPolygon(n, outline) && !onRing(outline, n)) continue;
    if (deg === 1) out.deadEnd++;
    else if (deg === 3) out.t++;
    else out.x++;
  }
  return out;
}

/** Length (m) of the section's streets, alleys excluded, clipped to the outline by edge midpoint. */
export function streetLength(graph: PlanarGraph, outline: readonly Vec2[]): number {
  let m = 0;
  for (const e of graph.edges()) {
    if (e.cls === 'frame' || e.cls === 'alley') continue;
    const a = graph.node(e.a);
    const b = graph.node(e.b);
    if (pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, outline) || onRing(outline, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) m += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return m;
}

const onRing = (ring: readonly Vec2[], p: Vec2, tol = 1.5): boolean => {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % ring.length] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= tol) return true;
  }
  return false;
};

interface FaceView {
  face: Face;
  ring: Vec2[];
  area: number;
  /** Half-edge ids (snapshot edge indices) walked once only: not antennas. */
  antennaEdges: Set<number>;
}

function sectionFaces(snap: GraphSnapshot, outline: readonly Vec2[]): FaceView[] {
  const out: FaceView[] = [];
  for (const face of extractFaces(snap).bounded) {
    const ip = interiorPoint(face);
    if (!ip || !pointInPolygon(ip, outline)) continue;
    const seen = new Map<number, number>();
    for (const r of face.boundary) seen.set(r.edge, (seen.get(r.edge) ?? 0) + 1);
    const antennaEdges = new Set<number>();
    for (const [e, c] of seen) if (c > 1) antennaEdges.add(e);
    out.push({ face, ring: face.ring, area: face.area, antennaEdges });
  }
  return out;
}

export interface SplitOptions {
  cls: string;
  /** Face-size distribution: median (m2) and the sigma of its log-normal. */
  median: number;
  sigma: number;
  /** Aligned (X) cuts allowed, steered by the junction-mix deficits. */
  junctionMix: boolean;
  /** Stop cutting when the section's junction nodes would exceed this (the measured intersection density). */
  maxJunctions?: number;
  /** ...or when the section's street length (m) would exceed this (the measured street km per km2)... */
  maxLength?: number;
  /** ...counting `reservePerJunction` m of dead-end spur for every junction node the section will have. */
  reservePerJunction?: number;
  rng: Rng;
  maxRounds: number;
}


/**
 * Splits every face of the section larger than its drawn target by a cut across its long axis, in
 * rounds until nothing splits. Each face draws from its own fork (keyed by where it is), so a face's
 * target and cut never depend on what happened to other faces. Returns the number of cuts made.
 */
export function splitFaces(lc: LayerContext, o: SplitOptions): number {
  const p = lc.params;
  const props = lc.props(o.cls);
  let cuts = 0;
  const final = new Set<string>();
  const known = new Map<string, number>();
  const parents: { ring: Vec2[]; q: number }[] = [];
  for (let round = 0; round < o.maxRounds; round++) {
    const snap = lc.graph.snapshot();
    const faces = sectionFaces(snap, lc.outline);
    let mix = junctionCounts(lc.graph, lc.outline);
    let length = o.maxLength === undefined ? 0 : streetLength(lc.graph, lc.outline);
    let changed = false;
    // Largest faces first: when the junction budget runs out, the biggest faces are the ones left whole.
    faces.sort((x, y) => y.area - x.area);
    for (const fv of faces) {
      if (o.maxJunctions !== undefined && mix.deadEnd + mix.t + mix.x + 2 > o.maxJunctions) break;
      const ip = interiorPoint(fv.face) as Vec2;
      const key = `${Math.round(ip.x * 10)},${Math.round(ip.y * 10)}`;
      if (final.has(key)) continue;
      // The size a face is cut down to is drawn once per lineage: a piece keeps the draw of the face it came from.
      let q = known.get(key);
      if (q === undefined) {
        const parent = parents.find((pr) => pointInPolygon(ip, pr.ring));
        q = parent ? parent.q : areaQuantile({ ...p.block, p50: o.median, sigma: o.sigma }, o.rng.fork(`target:${key}`).next());
        known.set(key, q);
      }
      // k leaves of about q each: a face worth fewer than two is finished.
      const k = Math.round(fv.area / q);
      if (k < 2) {
        final.add(key);
        continue;
      }
      const cut = chooseCut(lc, fv, faces, snap, o.rng.fork(`cut:${round}:${key}`), mix, o.junctionMix, q, k);
      if (!cut) {
        final.add(key);
        continue;
      }
      if (o.maxLength !== undefined && length + Math.hypot(cut.b.x - cut.a.x, cut.b.y - cut.a.y) + (cut.c ? Math.hypot(cut.c.x - cut.b.x, cut.c.y - cut.b.y) : 0) + (o.reservePerJunction ?? 0) * (mix.deadEnd + mix.t + mix.x + 2) > o.maxLength) break;
      // Sinuosity: one bend whose offset is |N(0, sigma)| x chord, capped at twice the measured p90.
      const d = o.rng.fork(`bend:${round}:${key}`);
      const [b1, b2, b3] = [d.next(), d.next(), d.next()];
      const chord = Math.hypot(cut.b.x - cut.a.x, cut.b.y - cut.a.y);
      const bulge = Math.min(2 * p.irregularityP90, Math.abs(gauss(b1, b2)) * p.irregularitySigma) * chord * (b3 < 0.5 ? -1 : 1);
      const mid = { x: (cut.a.x + cut.b.x) / 2 - ((cut.b.y - cut.a.y) / chord) * bulge, y: (cut.a.y + cut.b.y) / 2 + ((cut.b.x - cut.a.x) / chord) * bulge };
      parents.push({ ring: fv.ring, q });
      lc.graph.addPolyline(cut.c ? [cut.a, mid, cut.b, cut.c] : [cut.a, mid, cut.b], props);
      mix = junctionCounts(lc.graph, lc.outline);
      if (o.maxLength !== undefined) length = streetLength(lc.graph, lc.outline);
      cuts++;
      changed = true;
    }
    if (!changed) break;
  }
  return cuts;
}

interface Cut {
  a: Vec2;
  b: Vec2;
  /** A through cut: the street goes on across the neighbouring face to here (X junction at b). */
  c?: Vec2;
}

/** Elongation (long / short side of the minimum bounding box) of a ring. */
const elongationOf = (pts: readonly Vec2[]): number => {
  const o = minAreaObb(pts);
  return o.short > 1e-6 ? o.long / o.short : 1;
};

/** Pieces a chord a -> b cuts from the ring, as point lists. */
function pieces(ring: readonly Vec2[], a: Hit, b: Hit): [Vec2[], Vec2[]] {
  const n = ring.length;
  const walk = (from: Hit, to: Hit): Vec2[] => {
    const pts: Vec2[] = [from.pt];
    let i = (from.seg + 1) % n;
    for (let guard = 0; guard <= n; guard++) {
      pts.push(ring[i] as Vec2);
      if (i === to.seg) break;
      i = (i + 1) % n;
    }
    pts.push(to.pt);
    return pts;
  };
  return [walk(a, b), walk(b, a)];
}

interface Cand {
  cut: Cut;
  hits: [Hit, Hit];
  angle: number;
  elong: number;
  rank: number;
}

/** What judging a cut needs, per face: ring, which ring vertices are junctions, the antennas a cut must not cross. */
function cutJudge(lc: LayerContext, snap: GraphSnapshot, fv: FaceView, degree: ReadonlyMap<number, number>, q: number) {
  const p = lc.params;
  const ring = fv.ring;
  const r = p.block.p90 / p.block.p50;
  const fMin = 1 / (1 + r);
  const gap = p.segment.p10 / 2;
  // A cut ending near a mere bend of a street is snapped onto that bend by the graph (min street length), so bends need only the snap distance.
  const bend = lc.graph.tol.snap;
  const eStar = D.log(p.block.elongationAim);
  const junction = pinch(lc, fv, degree);
  const blockers = [...fv.antennaEdges].map((i) => snap.edges[i] as GraphSnapshot['edges'][number]);
  // A cut crosses no antenna and keeps `gap` from every antenna tip (a dead end that ends near a street is closed onto it by the cleanup).
  const tips = blockers.flatMap((e) => [e.a, e.b]).filter((n) => degree.get(n) === 1).map((n) => snap.nodes[n] as Vec2);
  const clear = (a: Vec2, b: Vec2): boolean =>
    !blockers.some((e) => segmentIntersection(a, b, snap.nodes[e.a] as Vec2, snap.nodes[e.b] as Vec2) !== undefined) &&
    tips.every((t) => distanceToSegment(t, a, b) >= gap);
  return (c: [Hit, Hit], rank: number, startsAtNode = false): Cand | undefined => {
    const [h0, h1] = c;
    const d = unit(angleOf({ x: h1.pt.x - h0.pt.x, y: h1.pt.y - h0.pt.y }));
    const chordLen = Math.hypot(h1.pt.x - h0.pt.x, h1.pt.y - h0.pt.y);
    const [pa, pb] = pieces(ring, h0, h1);
    const a1 = Math.abs(polyArea(pa));
    const a2 = Math.abs(polyArea(pb));
    if (chordLen < p.segment.p10) return undefined;
    // No piece smaller than half the size this lineage is cut down to.
    if (Math.min(a1, a2) < q / 2) return undefined;
    if ((!startsAtNode && !clearOfVertices(ring, junction, h0.pt, gap, bend)) || !clearOfVertices(ring, junction, h1.pt, gap, bend)) return undefined;
    if (!clear(h0.pt, h1.pt)) return undefined;
    const angle = Math.min(crossAngle(ring, h0.seg, d), crossAngle(ring, h1.seg, d));
    // A piece worth n leaves is cut across n times more elongated than a finished one (n leaves in a row).
    const want = (area: number): number => eStar + D.log(Math.max(1, Math.round(area / q)));
    const elong = (a1 * Math.abs(D.log(elongationOf(pa)) - want(a1)) + a2 * Math.abs(D.log(elongationOf(pb)) - want(a2))) / (a1 + a2);
    return { cut: { a: h0.pt, b: h1.pt }, hits: [h0, h1], angle, elong, rank };
  };
}

function chooseCut(
  lc: LayerContext,
  fv: FaceView,
  faces: readonly FaceView[],
  snap: GraphSnapshot,
  rng: Rng,
  mix: JunctionCounts,
  junctionMix: boolean,
  q: number,
  k: number,
): Cut | undefined {
  const p = lc.params;
  const ring = fv.ring;
  const nFam = p.families.length;
  const draw = Array.from({ length: nFam + 6 }, () => rng.next());
  const keys = draw.slice(0, nFam);
  const [g1, g2, f1, f2, , typeU] = draw.slice(nFam) as [number, number, number, number, number, number];
  const gap = p.segment.p10 / 2;
  const minAngle = (p.minAngleP10 * Math.PI) / 180;
  const obb = minAreaObb(ring);
  const u = obb.axis;
  const perpAngle = angleOf(u) + Math.PI / 2;
  const degree = new Map<number, number>();
  for (const e of snap.edges) {
    if (e.cls === 'frame') continue;
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const judgeOf = (x: FaceView) => cutJudge(lc, snap, x, degree, q);
  const evaluate = judgeOf(fv);
  const best = (cands: Cand[]): Cand | undefined => {
    // A cut crossing below the p10 junction angle is allowed but pays for every radian short of it.
    const score = (x: Cand): number => x.elong + Math.max(0, minAngle - x.angle) * 3 + x.rank * 0.02;
    const pool = cands;
    return pool.reduce<Cand | undefined>((m, c) => (!m || score(c) < score(m) ? c : m), undefined);
  };

  // X junctions wanted? Chance = share of the X deficit among the X and T deficits (a proportional controller on the measured mix).
  const deficitX = Math.max(0, p.mix.x - share(mix, 'x'));
  const deficitT = Math.max(0, p.mix.t - share(mix, 't'));
  const wantX = junctionMix && deficitX > 0 && typeU < 1;

  // Aligned cut: continue a street that arrives from the far side at a node of this face's ring,
  // bending by at most two corner jitters (the measured spread of right angles).
  if (wantX) {
    const own = new Set(fv.face.boundary.map((rf) => rf.edge));
    const cands: Cand[] = [];
    for (const nid of fv.face.ringNodes) {
      const N = snap.nodes[nid] as Vec2;
      for (const e of snap.edges) {
        if ((e.a !== nid && e.b !== nid) || own.has(e.id) || e.cls === 'frame') continue;
        const O = snap.nodes[e.a === nid ? e.b : e.a] as Vec2;
        const base = angleOf({ x: N.x - O.x, y: N.y - O.y });
        for (const bendAngle of [0, -p.jitter, p.jitter, -2 * p.jitter, 2 * p.jitter]) {
          const d = unit(base + bendAngle);
          if (!pointInPolygon({ x: N.x + d.x * 2, y: N.y + d.y * 2 }, ring)) continue;
          const hits = lineHits(ring, N, d);
          const far = hits.find((h) => h.t > 1);
          const entry = hits.find((h) => Math.abs(h.t) <= 1);
          if (!far || !entry) continue;
          const ev = evaluate([{ ...entry, t: -1, pt: N }, far], Math.abs(bendAngle) * 10, true);
          if (ev && ev.angle >= minAngle) cands.push(ev);
        }
      }
    }
    const pick = best(cands);
    if (pick) return pick.cut;
  }

  // Free cut across the long axis along a family direction (weighted random order by share).
  const order = p.families
    .map((f, i) => ({ i, key: D.pow(Math.max(1e-12, keys[i] as number), 1 / f.share) }))
    .sort((x, y) => y.key - x.key)
    .map((x) => x.i);
  const jitter = gauss(g1, g2) * p.jitter;
  const cands: Cand[] = [];
  const along = (frac: number, dir: Vec2, over: number, shift: number): Vec2 => ({
    x: obb.center.x + dir.x * (frac - 0.5) * over + dir.x * shift,
    y: obb.center.y + dir.y * (frac - 0.5) * over + dir.y * shift,
  });
  // A cut that stops a vertex gap short of a junction moves by that gap along the axis.
  // Equal pieces: k leaves are cut as floor(k/2) : ceil(k/2) from either end of the long axis; one leaf more or fewer
  // is allowed too (the shape scoring below decides: a 2:1 face gives better blocks as three strips than as two squares).
  const fracs = [k - 1, k, k + 1]
    .filter((kk) => kk >= 2)
    .flatMap((kk) => [Math.floor(kk / 2) / kk, 1 - Math.floor(kk / 2) / kk])
    .flatMap((x, i) => [-0.08, 0, 0.08].map((o) => x + o + ((i % 2 ? f2 : f1) - 0.5) * 0.04));
  for (const frac of fracs) {
    for (const shift of [0, gap, -gap]) {
      const origin = along(frac, u, obb.long, shift);
      order.forEach((fi, rank) => {
        const fam = (p.families[fi] as { rad: number }).rad;
        const dir = lineDiff(fam, perpAngle) <= lineDiff(fam + Math.PI / 2, perpAngle) ? fam : fam + Math.PI / 2;
        const chord = chordThrough(ring, origin, unit(dir + jitter));
        const ev = chord && evaluate(chord, rank + 1);
        if (ev) cands.push(ev);
      });
      const chord = chordThrough(ring, origin, unit(perpAngle + jitter));
      const ev = chord && evaluate(chord, nFam + 1);
      if (ev) cands.push(ev);
    }
  }
  // Along the long axis too: halving a squarish face lengthwise gives the elongated pieces the sample shows,
  // and a concave face (an avenue's bend) may have no clean cut across it. The scoring picks between them.
  const v = { x: -u.y, y: u.x };
  const longAngle = angleOf(u);
  for (const frac of fracs) {
    for (const shift of [0, gap, -gap]) {
      const origin = along(frac, v, obb.short, shift);
      order.forEach((fi, rank) => {
        const fam = (p.families[fi] as { rad: number }).rad;
        const dir = lineDiff(fam, longAngle) <= lineDiff(fam + Math.PI / 2, longAngle) ? fam : fam + Math.PI / 2;
        const chord = chordThrough(ring, origin, unit(dir + jitter));
        const ev = chord && evaluate(chord, rank + 2 + nFam);
        if (ev) cands.push(ev);
      });
    }
  }
  const pick = best(cands);
  if (!pick) return undefined;
  if (wantX) {
    // Through cut: carry the street on across the neighbouring face (X where it crosses the street between them).
    const good = cands.filter((c) => c.angle >= minAngle).sort((x, y) => x.elong + x.rank * 0.02 - (y.elong + y.rank * 0.02));
    for (const cand of good) {
      for (const [from, to] of [[cand.hits[0], cand.hits[1]], [cand.hits[1], cand.hits[0]]] as [Hit, Hit][]) {
        const d = unit(angleOf({ x: to.pt.x - from.pt.x, y: to.pt.y - from.pt.y }));
        const probe = { x: to.pt.x + d.x * 3, y: to.pt.y + d.y * 3 };
        const nb = faces.find((x) => x !== fv && Math.round(x.area / q) >= 2 && pointInPolygon(probe, x.ring));
        if (!nb) continue;
        const hits2 = lineHits(nb.ring, to.pt, d);
        const entry = hits2.find((h) => Math.abs(h.t) <= 1);
        const far = hits2.find((h) => h.t > 1);
        if (!entry || !far) continue;
        const ev = judgeOf(nb)([{ ...entry, t: -1, pt: to.pt }, far], 0, true);
        if (!ev || ev.angle < minAngle) continue;
        return { a: from.pt, b: to.pt, c: far.pt };
      }
    }
  }
  return pick.cut;
}

function share(c: JunctionCounts, k: keyof JunctionCounts): number {
  const n = c.deadEnd + c.t + c.x;
  return n === 0 ? 0 : c[k] / n;
}

/**
 * Dead ends: spurs from the boundary of a face into it, until the dead-end share of the junction
 * nodes reaches the measured mix. Spur length is drawn from the measured segment-length band.
 */
export function addDeadEnds(lc: LayerContext, rng: Rng): number {
  const p = lc.params;
  const props = lc.props(p.boundaryClass);
  const gap = p.segment.p10 / 2;
  const minAngle = (p.minAngleP10 * Math.PI) / 180;
  const segSigma = D.log(p.segment.p90 / p.segment.p10) / (2 * normalQuantile(0.9));
  let added = 0;
  for (let round = 0; round < 8; round++) {
    let mix = junctionCounts(lc.graph, lc.outline);
    const nodes = mix.deadEnd + mix.t + mix.x;
    if (nodes > 0 && mix.deadEnd / nodes >= p.mix.deadEnd + 1 / nodes) break;
    const snap = lc.graph.snapshot();
    const faces = sectionFaces(snap, lc.outline).sort((a, b) => b.area - a.area);
    let changed = false;
    let dead = mix.deadEnd;
    let total = nodes;
    for (const fv of faces) {
      const [uEdge, uPos, uLen, uJit, uJit2] = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
      if (total > 0 && dead / total >= p.mix.deadEnd + 1 / total) continue;
      const ring = fv.ring;
      const n = ring.length;
      const deg = new Map<number, number>();
      for (const e of snap.edges) {
        if (e.cls === 'frame') continue;
        deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
        deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
      }
      const junction = pinch(lc, fv, deg);
      // A cut ending near a mere bend of a street is snapped onto that bend by the graph (min street length), so bends need only the snap distance.
  const bend = lc.graph.tol.snap;
      // An X wanted and a street arriving at a node of this face: the spur continues it straight on (4-way junction).
      const needX = mix.x / Math.max(1, nodes) < p.mix.x;
      let P: Vec2 | undefined;
      let d: Vec2 = { x: 0, y: 0 };
      let far: Hit | undefined;
      if (needX) {
        const own = new Set(fv.face.boundary.map((rf) => rf.edge));
        outer: for (const nid of fv.face.ringNodes) {
          const N = snap.nodes[nid] as Vec2;
          for (const e of snap.edges) {
            if ((e.a !== nid && e.b !== nid) || own.has(e.id) || e.cls === 'frame') continue;
            const O = snap.nodes[e.a === nid ? e.b : e.a] as Vec2;
            const dir = unit(angleOf({ x: N.x - O.x, y: N.y - O.y }));
            if (!pointInPolygon({ x: N.x + dir.x * 2, y: N.y + dir.y * 2 }, ring)) continue;
            const f = lineHits(ring, N, dir).find((h) => h.t > 1);
            if (!f || f.t < p.segment.p10 + gap) continue;
            P = N;
            d = dir;
            far = f;
            break outer;
          }
        }
      }
      if (!P || !far) {
        // Longest-first choice among the ring edges, offset by the draw.
        const idx = [...Array(n).keys()].sort((i, j) => segLen(ring, j) - segLen(ring, i));
        const i = idx[Math.floor(uEdge * Math.min(3, n))] as number;
        const A = ring[i] as Vec2;
        const B = ring[(i + 1) % n] as Vec2;
        const el = Math.hypot(B.x - A.x, B.y - A.y);
        if (el < 2 * gap + 1) continue;
        const t = 0.3 + 0.4 * uPos;
        P = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
        // Inward normal of a counter-clockwise ring is the left normal, jittered.
        const inward = angleOf({ x: -(B.y - A.y), y: B.x - A.x }) + gauss(uJit, uJit2) * p.jitter;
        d = unit(inward);
        far = lineHits(ring, P, d).find((h) => h.t > 1);
        if (!far || !pointInPolygon({ x: P.x + d.x * 2, y: P.y + d.y * 2 }, ring)) continue;
        if (crossAngle(ring, i, d) < minAngle || !clearOfVertices(ring, junction, P, gap, bend)) continue;
      }
      const want = p.segment.p50 * D.exp(segSigma * normalQuantile(Math.min(0.999, Math.max(0.001, uLen))));
      // Stop short of the street ahead by at least its carriageway + sidewalk (the cleanup closes a dead end that reaches into it).
      const ahead = snap.edges.find((e) => {
        const a = fv.face.ringNodes[far.seg] as number;
        const b = fv.face.ringNodes[(far.seg + 1) % n] as number;
        return (e.a === a && e.b === b) || (e.a === b && e.b === a);
      });
      const room = Math.max(gap, ahead ? ahead.width / 2 + ahead.sidewalk + props.width / 2 + 2 * lc.graph.tol.snap + gap / 2 : gap);
      const len = Math.min(Math.max(want, p.segment.p10), far.t - room);
      if (len < p.segment.p10) continue;
      const tip = { x: P.x + d.x * len, y: P.y + d.y * len };
      lc.graph.addPolyline([P, tip], props);
      added++;
      mix = junctionCounts(lc.graph, lc.outline);
      dead = mix.deadEnd;
      total = mix.deadEnd + mix.t + mix.x;
      changed = true;
    }
    if (!changed) break;
  }
  return added;
}

const segLen = (ring: readonly Vec2[], i: number): number => {
  const a = ring[i] as Vec2;
  const b = ring[(i + 1) % ring.length] as Vec2;
  return Math.hypot(b.x - a.x, b.y - a.y);
};

/**
 * Offset junctions: two T junctions facing each other across a street (the street between them is a
 * short "jog") become one X junction when the streets that arrive can bend by no more than two corner
 * jitters to meet. Runs until the X share of the junction nodes reaches the measured mix.
 */
export function alignJogs(lc: LayerContext): number {
  const p = lc.params;
  const g = lc.graph;
  const street = (e: { cls: string }): boolean => e.cls !== 'frame' && e.cls !== 'alley';
  const maxBend = 2 * p.jitter;
  let merged = 0;
  for (let pass = 0; pass < 64; pass++) {
    const mix = junctionCounts(g, lc.outline);
    const n = mix.deadEnd + mix.t + mix.x;
    if (n > 0 && mix.x / n >= p.mix.x) break;
    let done = false;
    for (const e of g.edges()) {
      if (!street(e) || e.fixed) continue;
      const A = g.node(e.a);
      const B = g.node(e.b);
      if (A.pinned || B.pinned || g.degree(e.a, street) !== 3 || g.degree(e.b, street) !== 3) continue;
      if (!inOutline(lc.outline, A) || !inOutline(lc.outline, B)) continue;
      const jog = Math.hypot(B.x - A.x, B.y - A.y);
      const armOf = (nid: number): { len: number; side: number; far: Vec2 } | undefined => {
        const arms = g.incident(nid).map((id) => g.edge(id)).filter((f) => street(f) && f.id !== e.id);
        // The two other arms: the arriving street is the one not continuing the jog street straight on.
        const base = nid === e.a ? { x: B.x - A.x, y: B.y - A.y } : { x: A.x - B.x, y: A.y - B.y };
        const me = g.node(nid);
        let best: { len: number; side: number; far: Vec2; straight: number } | undefined;
        for (const f of arms) {
          if (f.fixed) return undefined;
          const o = g.node(g.other(f, nid));
          const v = { x: o.x - me.x, y: o.y - me.y };
          const len = Math.hypot(v.x, v.y);
          const straight = Math.abs((v.x * base.x + v.y * base.y) / (len * Math.hypot(base.x, base.y)));
          // the arriving street is the arm most perpendicular to the jog street
          if (!best || straight < best.straight) best = { len, side: Math.sign(base.x * v.y - base.y * v.x), far: o, straight };
        }
        return best;
      };
      const armA = armOf(e.a);
      const armB = armOf(e.b);
      if (!armA || !armB) continue;
      if (armA.side === armB.side) continue;
      // The one that moves is the node whose arriving street is longer (it bends less).
      const [keep, drop, moved] = armA.len <= armB.len ? [e.b, e.a, armB] : [e.a, e.b, armA];
      void moved;
      const dropArm = armA.len <= armB.len ? armA : armB;
      if (D.atan2(jog, dropArm.len) > maxBend) continue;
      if (jog > p.segment.p10) continue;
      g.mergeNodes(keep, drop);
      merged++;
      done = true;
      break;
    }
    if (!done) break;
  }
  return merged;
}

const inOutline = (outline: readonly Vec2[], pt: Vec2): boolean => pointInPolygon(pt, outline) || onRing(outline, pt);
