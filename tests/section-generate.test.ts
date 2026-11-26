// Card 3b: the section generator (src/world/streets/section/) built from specs/map/sections/el-corredor.json.
// Guards: gap vs the profile, enclosure (crossings == openings), ports contract, per-profile density, Act 1 gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pointInPolygon } from '../src/world/geometry.ts';
import { createRng } from '../src/world/rng.ts';
import { loadSectionProfiles, parseSectionProfile, parseWorldSpec, type SectionProfile } from '../src/world/spec.ts';
import { buildBlocks } from '../src/world/streets/faces.ts';
import type { GraphSnapshot } from '../src/world/streets/planar-graph.ts';
import { PlanarGraph } from '../src/world/streets/planar-graph.ts';
import { generateSection, portMismatch } from '../src/world/streets/section/index.ts';
import { parseWorldWithEdits } from '../src/studio/saved.ts';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { buildWalkGraph } from '../src/world/walk-graph.ts';
import type { Vec2 } from '../src/world/vec.ts';
import { inOrOn, measureSection } from './section-check.ts';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const yaml = read('specs/map/world.yaml');
const authored = parseWorldSpec(yaml);
const profile = loadSectionProfiles(authored, read)['el-corredor'] as SectionProfile;
const range = profile.range;
type Q = { p10: number; p50: number; p90: number };
const ref = profile as unknown as { network: { segment_length_m: Q; junction_mix: { dead_end: number; t: number; x: number }; street_km_per_km2: number; intersections_per_km2: number }; blocks: { elongation: Q; sides: Q; area_m2: Q } };
const HIER = { local: { width: 7, sidewalk: 2 }, alley: { width: 3.5, sidewalk: 0 } };
const WALK = ['avenue', 'collector', 'local', 'alley'];

// The game's world: the baked isthmus applies the saved Studio edits (tools/vite-isthmus.ts), so the test does too.
const iso = generateIsthmus(parseWorldWithEdits(yaml, read('specs/map/procedural-edits.json')));
const data = buildWorldData(yaml, iso);
const section = (data.streets.sections ?? [])[0];
assert.ok(section, 'Act 1 has a section');

const components = (g: GraphSnapshot): number => walkComponents(buildWalkGraph(g, () => true, WALK));
const walkComponents = (w: ReturnType<typeof buildWalkGraph>): number => {
  const seen = new Array<boolean>(w.nodes.length).fill(false);
  let n = 0;
  for (let s = 0; s < w.nodes.length; s++) {
    if (seen[s]) continue;
    n++;
    seen[s] = true;
    const st = [s];
    while (st.length) {
      const u = st.pop() as number;
      for (const e of w.adjacency[u] as number[]) {
        const ed = w.edges[e] as { a: number; b: number };
        const v = ed.a === u ? ed.b : ed.a;
        if (!seen[v]) {
          seen[v] = true;
          st.push(v);
        }
      }
    }
  }
  return n;
};

/**
 * Street ends crossing the boundary: boundary-road nodes with a street edge that goes on to the outside
 * (its far end more than 3 m outside the outline). Boundary road and streets running along it do not count.
 */
function crossings(g: GraphSnapshot, outline: readonly Vec2[]): number {
  const nodes = new Set<number>();
  for (const e of g.edges) {
    if (e.cls === 'frame') continue;
    const a = g.nodes[e.a] as Vec2;
    const b = g.nodes[e.b] as Vec2;
    const outA = !inOrOn(outline, a, 3);
    const outB = !inOrOn(outline, b, 3);
    if (outA && !outB) nodes.add(e.b);
    else if (outB && !outA) nodes.add(e.a);
  }
  return nodes.size;
}

/** Share of the boundary road (sampled every 4 m) that has a street edge within 2 m: 1 = closed all round. */
function closedShare(g: GraphSnapshot, outline: readonly Vec2[]): number {
  let n = 0;
  let ok = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Vec2;
    const b = outline[(i + 1) % outline.length] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s <= len; s += 4) {
      const p = { x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len };
      n++;
      if (
        g.edges.some((e) => {
          if (e.cls === 'frame') return false;
          const A = g.nodes[e.a] as Vec2;
          const B = g.nodes[e.b] as Vec2;
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / (dx * dx + dy * dy)));
          return Math.hypot(A.x + dx * t - p.x, A.y + dy * t - p.y) <= 2;
        })
      )
        ok++;
    }
  }
  return ok / n;
}

const rectangle = (w: number, h: number, at: Vec2 = { x: 0, y: 0 }): Vec2[] => [
  { x: at.x, y: at.y },
  { x: at.x + w, y: at.y },
  { x: at.x + w, y: at.y + h },
  { x: at.x, y: at.y + h },
];

const withOpenings = (p: SectionProfile, min: number, max: number): SectionProfile => ({ ...p, boundary: { ...p.boundary, openings: { min, max } } });

function standalone(p: SectionProfile, outline: Vec2[], seed: number): { graph: PlanarGraph; info: ReturnType<typeof generateSection> } {
  const graph = new PlanarGraph();
  const info = generateSection({ profile: p, graph, outline, hierarchy: HIER, rng: createRng(seed) });
  return { graph, info };
}

// ------------------------------------------------------------------ 1. gap vs the profile

test('Act 1 section: every measure within the profile range (or the stated tolerance of the reference)', () => {
  const sec = section!;
  const m = measureSection(data.streets.graph, data.streets.blocks, sec.outline, data.slice.isPlayableLand);
  const rows: [string, number, number, number, number][] = [];
  const within = (name: string, got: number, ref: number, key: string): void => {
    const r = range[key] as { min: number; max: number };
    rows.push([name, got, ref, r.min, r.max]);
    assert.ok(got >= r.min && got <= r.max, `${name} ${got.toFixed(3)} outside the profile range [${r.min}, ${r.max}] (reference ${ref})`);
  };
  within('segment length p50 (m, between junctions)', m.network.segmentP50, ref.network.segment_length_m.p50, 'segment_length_p50_m');
  within('junction mix dead end', m.network.deadEnd, ref.network.junction_mix.dead_end, 'junction_mix_dead_end');
  within('junction mix T', m.network.t, ref.network.junction_mix.t, 'junction_mix_t');
  within('junction mix X', m.network.x, ref.network.junction_mix.x, 'junction_mix_x');
  within('street km / km2', m.network.streetKmPerKm2, ref.network.street_km_per_km2, 'street_km_per_km2');
  within('intersections / km2', m.network.intersectionsPerKm2, ref.network.intersections_per_km2, 'intersections_per_km2');
  within('block elongation p50', m.blocks.elongationP50, ref.blocks.elongation.p50, 'block_elongation_p50');
  within('block sides p50', m.blocks.sidesP50, ref.blocks.sides.p50, 'block_sides_p50');
  // Block area has no range in the profile: stated tolerance of the reference. The reference percentiles come from n = 39 blocks
  // of log-normal spread sigma = 0.39; the standard error of a sample median is 1.25 sigma / sqrt(n) = 8 %, of a p10 / p90 about 11 %.
  // Tolerance: 25 % on p50 (3 se) and 40 % on p10 / p90 (3.6 se), which also leaves room for the generator's own sampling noise (~100 blocks).
  const tol = { p10: 0.4, p50: 0.25, p90: 0.4 } as const;
  for (const k of ['p10', 'p50', 'p90'] as const) {
    const want = ref.blocks.area_m2[k];
    const got = m.blocks.area[k];
    rows.push([`block area ${k} (m2, +-${tol[k] * 100}%)`, got, want, want * (1 - tol[k]), want * (1 + tol[k])]);
    assert.ok(Math.abs(got / want - 1) <= tol[k], `block area ${k} ${got.toFixed(0)} is ${((got / want - 1) * 100).toFixed(0)}% off the reference ${want}`);
  }
  console.log('measure                                     generated   reference   range min / max');
  for (const [n, g, r, lo, hi] of rows) console.log(`${n.padEnd(44)}${g.toFixed(3).padStart(9)}${r.toFixed(3).padStart(12)}   ${lo.toFixed(3)} / ${hi.toFixed(3)}`);
  console.log(`street-only faces (alleys removed): n=${m.streetFaces.n} p10/p50/p90 = ${[m.streetFaces.area.p10, m.streetFaces.area.p50, m.streetFaces.area.p90].map(Math.round)}`);
});

// ------------------------------------------------------------------ 2. enclosure

test('Act 1 section: the border is closed all round and street ends crossing it == the chosen openings (<= profile max)', () => {
  const sec = section!;
  const max = profile.boundary.openings.max;
  assert.ok(sec.ports.length >= profile.boundary.openings.min && sec.ports.length <= max, `${sec.ports.length} openings, profile allows ${profile.boundary.openings.min}..${max}`);
  assert.equal(crossings(data.streets.graph, sec.outline), sec.ports.length, 'street ends crossing the boundary == openings');
  assert.ok(closedShare(data.streets.graph, sec.outline) >= 0.999, 'boundary road is continuous');
});

test('standalone sections: crossings == openings for 0, 1 and 2 chosen openings', () => {
  for (const n of [0, 1, 2]) {
    const { graph, info } = standalone(withOpenings(profile, n, n), rectangle(700, 650), 7);
    const snap = graph.snapshot();
    assert.equal(info.ports.length, n);
    assert.equal(crossings(snap, info.outline), n, `${n} openings`);
    assert.ok(closedShare(snap, info.outline) >= 0.999);
  }
});

// ------------------------------------------------------------------ 3. ports contract

/** A small synthetic profile that is not a real district: one orthogonal grid, other densities, other blocks. */
const FIXTURE: SectionProfile = {
  ...profile,
  id: 'fixture',
  district: 'airport',
  boundary: { kind: 'road', openings: { min: 1, max: 1 } },
  network: {
    ...profile.network,
    orientation_families: [{ deg: 10, share: 0.6 }, { deg: 100, share: 0.4 }],
    segment_length_m: { p10: 40, p50: 80, p90: 160, n: 10 },
    street_km_per_km2: 14,
    intersections_per_km2: 120,
  },
  blocks: { ...profile.blocks, area_m2: { p10: 3500, p50: 6000, p90: 9000, n: 10 } },
};

const TOL = { position: 0.5, heading: 0.02, width: 0.01 };

function join(a: ReturnType<typeof standalone>, b: ReturnType<typeof standalone>): { graph: PlanarGraph; mismatch: string[]; overlap: boolean } {
  const pa = a.info.ports[0]!;
  const pb = b.info.ports[0]!;
  // Rotate / move B so its port lands on A's with the opposite heading.
  const rot = pa.heading + Math.PI - pb.heading;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const to = (p: Vec2): Vec2 => ({ x: pa.at.x + (p.x - pb.at.x) * c - (p.y - pb.at.y) * s, y: pa.at.y + (p.x - pb.at.x) * s + (p.y - pb.at.y) * c });
  const joined = new PlanarGraph();
  const add = (g: GraphSnapshot, f: (p: Vec2) => Vec2): void => {
    for (const e of g.edges) {
      const { id: _i, a: ia, b: ib, length: _l, ...props } = e;
      joined.addSegment(f(g.nodes[ia] as Vec2), f(g.nodes[ib] as Vec2), props);
    }
  };
  add(a.graph.snapshot(), (p) => p);
  add(b.graph.snapshot(), to);
  const pbm = { ...pb, at: to(pb.at), crossing: to(pb.crossing), heading: pb.heading + rot };
  const outB = b.info.outline.map(to);
  const overlap = outB.some((p) => pointInPolygon(p, a.info.outline)) || a.info.outline.some((p) => pointInPolygon(p, outB));
  return { graph: joined, mismatch: portMismatch(pa, pbm, TOL), overlap };
}

test('ports contract: two sections from two different profiles join at matching ports, no gap, no overlap, one walk component', () => {
  assert.deepEqual(parseSectionProfile(JSON.stringify(FIXTURE), authored).problems, [], 'fixture is a valid profile');
  const a = standalone(withOpenings(profile, 1, 1), rectangle(600, 560), 3);
  const b = standalone(FIXTURE, rectangle(300, 320), 5);
  assert.equal(a.info.ports.length, 1);
  assert.equal(b.info.ports.length, 1);
  // The heading a port reports is the real direction of its road out of the boundary (crossing -> tip).
  for (const pt of [a.info.ports[0]!, b.info.ports[0]!]) {
    const real = Math.atan2(pt.at.y - pt.crossing.y, pt.at.x - pt.crossing.x);
    assert.ok(Math.abs(Math.atan2(Math.sin(pt.heading - real), Math.cos(pt.heading - real))) < 0.02, 'port heading points out along its road');
  }
  assert.equal(components(a.graph.snapshot()), 1);
  assert.equal(components(b.graph.snapshot()), 1);
  const j = join(a, b);
  assert.deepEqual(j.mismatch, [], 'ports match: position, opposite heading, class, width');
  assert.equal(j.overlap, false, 'the two sections do not overlap');
  const snap = j.graph.snapshot();
  assert.equal(components(snap), 1, 'joined: one walk component');
  // No gap: the two tips are one node of degree 2 (the opening road continues through it).
  const pa = a.info.ports[0]!;
  const tip = snap.nodes.find((n) => Math.hypot(n.x - pa.at.x, n.y - pa.at.y) < 1);
  assert.ok(tip, 'joined tip node exists');
  assert.equal(snap.edges.filter((e) => e.a === tip!.id || e.b === tip!.id).length, 2);
});

test('ports contract detects a mismatch (heading, shift, class, width)', () => {
  const p = { at: { x: 0, y: 0 }, crossing: { x: 0, y: 0 }, heading: 0, cls: 'local', width: 7, through: false };
  const q = { ...p, heading: Math.PI };
  assert.deepEqual(portMismatch(p, q, TOL), []);
  assert.ok(portMismatch(p, { ...q, heading: Math.PI + 0.3 }, TOL).length > 0);
  assert.ok(portMismatch(p, { ...q, at: { x: 10, y: 0 } }, TOL).length > 0);
  assert.ok(portMismatch(p, { ...q, cls: 'alley' }, TOL).length > 0);
  assert.ok(portMismatch(p, { ...q, width: 9 }, TOL).length > 0);
});

// ------------------------------------------------------------------ 4. each section has its own density

test('density comes from the profile of the section: same region, two profiles, two densities', () => {
  const region = rectangle(700, 650);
  const dens = (km: number, ix: number): { km: number; ix: number } => {
    const p: SectionProfile = { ...profile, network: { ...profile.network, street_km_per_km2: km, intersections_per_km2: ix } };
    const { graph, info } = standalone(p, region, 1);
    const snap = graph.snapshot();
    const blocks = buildBlocks(snap, { isInside: () => true, districtOf: () => 'x' });
    const m = measureSection(snap, blocks, info.outline, () => true);
    return { km: m.network.streetKmPerKm2, ix: m.network.intersectionsPerKm2 };
  };
  const hi = { km: 19.51, ix: 203.6 };
  const lo = { km: 12, ix: 110 };
  const gHi = dens(hi.km, hi.ix);
  const gLo = dens(lo.km, lo.ix);
  console.log(`density target -> generated: km/km2 ${hi.km} -> ${gHi.km.toFixed(2)}, ${lo.km} -> ${gLo.km.toFixed(2)}; intersections/km2 ${hi.ix} -> ${gHi.ix.toFixed(1)}, ${lo.ix} -> ${gLo.ix.toFixed(1)}`);
  assert.ok(gHi.km > gLo.km && gHi.ix > gLo.ix, 'generated densities differ in the direction of the profiles');
  // Street km is an upper budget the generator fills to within 15 %. Intersections are a budget too, but the km budget binds first
  // (the boundary road and the dead-end spurs take length without adding as many junctions per km as the sample's streets do),
  // so the generator reaches between 40 % and 100 % of the profile value; both directions are guarded above.
  for (const [g, t] of [[gHi, hi], [gLo, lo]] as const) {
    assert.ok(Math.abs(g.km / t.km - 1) <= 0.15, `street km ${g.km.toFixed(2)} vs profile ${t.km}`);
    assert.ok(g.ix / t.ix >= 0.4 && g.ix / t.ix <= 1.0, `intersections ${g.ix.toFixed(1)} vs profile ${t.ix}`);
  }
});

test('each density is read on its own: same street km, different intersection density (and the reverse)', () => {
  const region = rectangle(700, 650);
  const run = (km: number, ix: number): { km: number; ix: number } => {
    const p: SectionProfile = { ...profile, network: { ...profile.network, street_km_per_km2: km, intersections_per_km2: ix } };
    const { graph, info } = standalone(p, region, 1);
    const snap = graph.snapshot();
    const m = measureSection(snap, buildBlocks(snap, { isInside: () => true, districtOf: () => 'x' }), info.outline, () => true);
    return { km: m.network.streetKmPerKm2, ix: m.network.intersectionsPerKm2 };
  };
  const a = run(19.51, 203.6);
  const b = run(19.51, 90);
  const c = run(10, 203.6);
  console.log(`km/km2 19.51 fixed: intersections 203.6 -> ${a.ix.toFixed(1)}, 90 -> ${b.ix.toFixed(1)}; intersections 203.6 fixed: km 19.51 -> ${a.km.toFixed(2)}, 10 -> ${c.km.toFixed(2)}`);
  assert.ok(b.ix < a.ix * 0.85, 'a lower intersection density in the profile gives fewer junctions per km2');
  assert.ok(c.km < a.km * 0.8, 'a lower street km density in the profile gives fewer km per km2');
});

// ------------------------------------------------------------------ 5. Act 1 gate

test('Act 1 gate: one walk component, landmarks inside the section, no block under 100 m2, size caps', () => {
  const sec = section!;
  assert.equal(walkComponents(data.walkGraph), 1, 'Act 1 walk graph is exactly one component');
  for (const id of ['tito-home', 'corridor-market', 'miguelito-hills']) {
    const l = data.spec.landmarks.find((x) => x.id === id);
    assert.ok(l, id);
    assert.ok(pointInPolygon(l!.position, sec.outline), `${id} inside the neighbourhood`);
  }
  assert.ok(data.streets.blocks.every((b) => b.area >= 100), 'no block under 100 m2');
  assert.ok(data.buildings.length <= 2500, `buildings ${data.buildings.length}`);
  assert.ok(data.streets.graph.edges.length <= 1500, `street edges ${data.streets.graph.edges.length}`);
});

test('Act 1 timing: streets + city under 1 s', () => {
  const t = performance.now();
  buildWorldData(yaml, iso);
  const ms = performance.now() - t;
  console.log(`streets + city + walk graph: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});

test('deterministic: two builds give the same section', () => {
  const again = buildWorldData(yaml, iso);
  assert.deepEqual(again.streets.sections, data.streets.sections);
  assert.equal(again.streets.graph.edges.length, data.streets.graph.edges.length);
});
