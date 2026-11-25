// Map Studio invariant guards (#13 step 6). Each guard is shown to pass on the real map and to fire on a
// map broken in exactly the way it protects (the mutation check lives in the test).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { parseWorldSpec, type ProceduralSpec } from '../src/world/spec.ts';
import { GUARDS } from '../src/studio/guards.ts';
import { metricsOf, type Metrics } from '../src/studio/metrics.ts';

const spec = parseWorldSpec(readFileSync(new URL('../specs/map/world.yaml', import.meta.url), 'utf8'));
let iso: Isthmus;
let P: ProceduralSpec;
let M: Metrics;
before(() => {
  iso = generateIsthmus(spec, { cell: 40 });
  P = spec.procedural;
  M = metricsOf(iso, P);
});

const fires = (guard: string, over: { iso?: Isthmus; config?: ProceduralSpec; metrics?: Partial<Metrics> } = {}): string | undefined =>
  GUARDS[guard]!({ iso: over.iso ?? iso, config: over.config ?? P, metrics: { ...M, ...over.metrics } });
const withMask = (m: Isthmus['lake']['lake'], edit: (d: Uint8Array) => void) => {
  const data = Uint8Array.from(m.data);
  edit(data);
  return { ...m, data };
};
const firstIndex = (a: ArrayLike<number>, pred: (v: number, i: number) => boolean): number => {
  for (let i = 0; i < a.length; i++) if (pred(a[i]!, i)) return i;
  throw new Error('no cell');
};
const centreOf = (i: number) => ({ x: ((i % iso.height.w) + 0.5) * iso.height.cell, y: (Math.floor(i / iso.height.w) + 0.5) * iso.height.cell });

test('every guard passes on the default map', () => {
  for (const g of Object.keys(GUARDS)) assert.equal(fires(g), undefined, g);
});

test('reservoir-connected: cutting the lake in two fires', () => {
  const { w, h } = iso.height;
  const lake = withMask(iso.lake.lake, (d) => {
    // Clear a full-height column through the middle of the lake's bounding box.
    const xs = [...d.keys()].filter((i) => d[i]).map((i) => i % w);
    const mid = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    for (let y = 0; y < h; y++) d[y * w + mid] = 0;
  });
  assert.match(fires('reservoir-connected', { iso: { ...iso, lake: { ...iso.lake, lake } } })!, /separate bodies/);
});

test('rivers-drain: a river ending in the middle of dry land fires', () => {
  const { w, h } = iso.height;
  // A dry cell with no water within 6 cells, and no river end or airfield near it.
  const dry = firstIndex(iso.relief.land.data, (v, i) => {
    if (!v) return false;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x < 8 || y < 8 || x >= w - 8 || y >= h - 8) return false;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const j = (y + dy) * w + x + dx;
      if (!iso.relief.land.data[j] || iso.lake.lake.data[j] || iso.canal.channel.data[j]) return false;
    }
    return true;
  });
  const p = centreOf(dry);
  const rivers = [{ points: [{ x: p.x - 400, y: p.y }, p], width: 5, areaKm2: 1 }];
  // Keep the point away from every other river and from water.
  assert.match(fires('rivers-drain', { iso: { ...iso, rivers } })!, /river/);
});

test('canal-connects-seas: a broken or landlocked centreline fires', () => {
  const c = iso.canal.centreline;
  assert.match(fires('canal-connects-seas', { iso: { ...iso, canal: { ...iso.canal, centreline: [...c.slice(0, 10), ...c.slice(40)] } } })!, /breaks/);
  assert.match(fires('canal-connects-seas', { iso: { ...iso, canal: { ...iso.canal, centreline: c.slice(0, 10) } } })!, /open sea|reservoir/);
});

test('no-towns-on-water / no-runways-on-water fire when a town or runway sits in the sea', () => {
  const sea = firstIndex(iso.relief.land.data, (v) => !v);
  const owner = Uint8Array.from(iso.towns.owner);
  owner[sea] = 1;
  assert.match(fires('no-towns-on-water', { iso: { ...iso, towns: { ...iso.towns, owner } } })!, /on water/);
  const s = centreOf(sea);
  const runways = iso.airport.runways.map((r, k) => (k ? r : { ...r, a: s, b: s }));
  assert.match(fires('no-runways-on-water', { iso: { ...iso, airport: { ...iso.airport, runways } } })!, /runway/);
});

test('airport-buffer / airport-detached-from-core fire on short distances', () => {
  assert.match(fires('airport-buffer', { metrics: { airportToTownM: 10 } })!, /buffer/);
  assert.match(fires('airport-detached-from-core', { metrics: { airportToDenseCoreM: 50 } })!, /dense core/);
});

test('transport-crosses-water-only-on-bridges: a road through the reservoir or the sea fires', () => {
  const lakeCell = firstIndex(iso.lake.lake.data, (v) => !!v);
  const paths = iso.roads.paths.map((p, k) => (k ? p : { ...p, cells: [...p.cells, lakeCell] }));
  assert.match(fires('transport-crosses-water-only-on-bridges', { iso: { ...iso, roads: { ...iso.roads, paths } } })!, /reservoir/);
  const sea = centreOf(firstIndex(iso.relief.land.data, (v) => !v));
  const lines = iso.transit.lines.map((l, k) => (k ? l : { ...l, tracks: [[...l.tracks[0]!, sea], ...l.tracks.slice(1)] }));
  assert.match(fires('transport-crosses-water-only-on-bridges', { iso: { ...iso, transit: { ...iso.transit, lines } } })!, /open sea/);
});

test('routes-connected: a missing route or a track that stops short fires', () => {
  assert.match(fires('routes-connected', { iso: { ...iso, roads: { ...iso.roads, paths: iso.roads.paths.slice(1) } } })!, /no path/);
  const paths = iso.roads.paths.map((p, k) => (k ? p : { ...p, points: p.points.slice(0, 3) }));
  assert.match(fires('routes-connected', { iso: { ...iso, roads: { ...iso.roads, paths } } })!, /does not reach/);
  const lines = iso.transit.lines.map((l, k) => (k ? l : { ...l, tracks: [l.tracks[0]!.slice(0, 2), ...l.tracks.slice(1)] }));
  assert.match(fires('routes-connected', { iso: { ...iso, transit: { ...iso.transit, lines } } })!, /does not reach/);
});

test('linea-2-unchanged: merging or re-ending the branches fires', () => {
  const lines = P.transit.lines.map((l) => (l.id === 'linea-2' ? { ...l, branches: [l.branches[0]!] } : l));
  assert.match(fires('linea-2-unchanged', { config: { ...P, transit: { ...P.transit, lines } } })!, /branches/);
  const re = P.transit.lines.map((l) => (l.id === 'linea-2' ? { ...l, branches: [[...l.branches[0]!.slice(0, -1), 'north'], l.branches[1]!] } : l));
  assert.match(fires('linea-2-unchanged', { config: { ...P, transit: { ...P.transit, lines: re } } })!, /must run/);
});

test('pinned-places-on-land and wilderness-between-centres fire', () => {
  assert.match(fires('pinned-places-on-land', { iso: { ...iso, act1: { ...iso.act1, anchorDry: false } } })!, /dry land/);
  const sea = centreOf(firstIndex(iso.relief.land.data, (v) => !v));
  const landmarks = iso.landmarks.map((l, k) => (k ? l : { ...l, at: sea }));
  assert.match(fires('pinned-places-on-land', { iso: { ...iso, landmarks } })!, /on water/);
  assert.match(fires('wilderness-between-centres', { metrics: { wildernessShare: 0.3 } })!, /wilderness/);
});
