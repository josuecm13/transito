// The spec the game's slice / streets / city pipeline runs on, derived from the procedural map
// (#12 2.5, card F2; procedural.game, src/world/proc/game-spec.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { parseWorldSpec, WorldSpecError } from '../src/world/spec.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { gameSpecFromIsthmus, type GameSpec } from '../src/world/proc/game-spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import { parseWorldWithEdits } from '../src/studio/saved.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { deriveCity, generateStreets } from '../src/world/streets/index.ts';

const yaml = readFileSync(new URL('../specs/map/world.yaml', import.meta.url), 'utf8');
const spec = parseWorldSpec(yaml);
let iso: Isthmus;
let game: GameSpec;
before(() => {
  iso = generateIsthmus(spec);
  game = gameSpecFromIsthmus(spec, iso);
});
const codeAt = (g: GameSpec, x: number, y: number): string => {
  const cs = g.spec.bounds.cellSize;
  const rows = g.spec.grid.length;
  return g.spec.grid[rows - 1 - Math.floor(y / cs)]![Math.floor(x / cs)]!;
};
const code = (id: string): string => spec.districts.find((d) => d.id === id)!.code;

test('spec: procedural.game names a district for every source; broken blocks are rejected', () => {
  const G = spec.procedural.game;
  assert.equal(G.districtCell, 80);
  assert.equal(G.districts['el-corredor'], 'tito-corridor');
  assert.deepEqual(Object.keys(G.districts).sort(), ['airport', 'balboa', 'colon', 'el-corredor', 'gamboa', 'la-ciudad', 'lake', 'sea', 'wild']);
  const broken = (from: RegExp, to: string, why: RegExp): void => {
    const text = yaml.replace(from, to);
    assert.notEqual(text, yaml, `mutation ${from} must change the yaml`);
    assert.throws(() => parseWorldSpec(text), (e: unknown) => e instanceof WorldSpecError && why.test(e.message), String(from));
  };
  broken(/district_cell: 80 /, 'district_cell: 300 ', /district_cell: 300 m must divide the bounds/);
  broken(/el-corredor: tito-corridor, gamboa/, 'el-corredor: barrio, gamboa', /districts\.el-corredor: unknown district "barrio"/);
  broken(/, gamboa: canal-central }/, ' }', /districts\.gamboa: missing/);
});

test('active area: the Act 1 strip and barrio, spawning at the procedural tito-home', () => {
  const a = game.spec.activeArea;
  const m = spec.procedural.game.rectMargin;
  const { strip, barrio } = iso.act1;
  for (const q of strip.centreline) {
    assert.ok(q.x - strip.halfWidth >= a.x[0] && q.x + strip.halfWidth <= a.x[1] && q.y - strip.halfWidth >= a.y[0] && q.y + strip.halfWidth <= a.y[1], `strip point (${q.x}, ${q.y})`);
  }
  assert.ok(barrio.centre.x - barrio.radius - m >= a.x[0] - 1 && barrio.centre.y - barrio.radius - m >= a.y[0] - 1);
  const slice = sliceWorld(game.spec);
  const home = iso.landmarks.find((l) => l.id === 'tito-home')!.at;
  assert.equal(slice.spawn.id, 'tito-home');
  assert.deepEqual(slice.spawn.position, home);
});

test('grid: derived from the generated map on district_cell cells', () => {
  const g = game.spec;
  const cs = spec.procedural.game.districtCell;
  assert.equal(g.bounds.cellSize, cs);
  assert.equal(g.grid.length, spec.bounds.height / cs);
  assert.ok(g.grid.every((r) => r.length === spec.bounds.width / cs));
  assert.equal(codeAt(game, iso.act1.anchor.x, iso.act1.anchor.y), code('tito-corridor'));
  assert.equal(codeAt(game, iso.airport.centre.x, iso.airport.centre.y), code('airport'));
  assert.equal(codeAt(game, 3000, 50), code('sea'));
  // El Corredor's cells add up to about its generated area (the grid follows the town, not the 1 km authored cells).
  const t = g.grid.flat().filter((c) => c === code('tito-corridor')).length * ((cs * cs) / 1e6);
  const corridor = iso.towns.areasKm2[spec.procedural.act1.townIndex]!;
  assert.ok(Math.abs(t - corridor) < corridor * 0.5, `${t.toFixed(2)} km² of T cells vs ${corridor.toFixed(2)} km² built`);
});

test('landmarks and routes: procedural positions and generated roads, nothing authored left inside the area', () => {
  const a = game.spec.activeArea;
  const inRect = (p: { x: number; y: number }) => p.x >= a.x[0] && p.x <= a.x[1] && p.y >= a.y[0] && p.y <= a.y[1];
  for (const l of iso.landmarks) {
    const g = game.spec.landmarks.find((m) => m.id === l.id)!;
    assert.deepEqual(g.position, l.at);
    assert.equal(code(g.district), codeAt(game, l.at.x, l.at.y), `${l.id} district matches its cell`);
  }
  const placed = new Set(iso.landmarks.map((l) => l.id));
  for (const l of game.spec.landmarks) if (inRect(l.position)) assert.ok(placed.has(l.id), `${l.id} is authored and inside the area`);
  assert.deepEqual([...game.dropped].sort(), spec.landmarks.filter((l) => inRect(l.position) && !placed.has(l.id)).map((l) => l.id).sort());
  const ids = game.spec.routes.map((r) => r.id);
  assert.ok(!ids.includes('corridor-avenue') && !ids.includes('transisthmian-highway'), ids.join(', '));
  assert.ok(ids.includes('interamericana') && ids.includes('runway-1') && ids.includes('canal'));
});

test('the street and city pipeline runs on it: El Corredor gets streets and houses, only on its cells', () => {
  const slice = sliceWorld(game.spec);
  const net = generateStreets(game.spec, slice);
  const city = deriveCity(game.spec, slice, net);
  assert.ok(net.graph.edges.length > 200, `${net.graph.edges.length} street edges`);
  assert.ok(city.buildings.length > 500, `${city.buildings.length} buildings`);
  const onT = city.buildings.filter((b) => codeAt(game, b.center.x, b.center.y) === code('tito-corridor')).length;
  assert.ok(onT / city.buildings.length > 0.95, `${onT} of ${city.buildings.length} buildings on El Corredor cells`);
});

test('district labels: every map label lands on its own district of the derived grid; authored ones kept where they still do', async () => {
  const { districtLabelPoint } = await import('../src/world/spec.ts');
  let labelled = 0;
  for (const d of game.spec.districts) {
    const at = districtLabelPoint(game.spec, d);
    if (!at) continue;
    labelled++;
    assert.equal(codeAt(game, at.x, at.y), d.code, `${d.id} label at ${at.x},${at.y}`);
  }
  assert.ok(labelled >= 5, `labelled ${labelled}`);
  // The authored airport label (5500, 450) is off the generated airfield: it falls back to the derived cells.
  assert.ok(spec.districts.find((d) => d.id === 'airport')!.labelAt);
  assert.equal(game.spec.districts.find((d) => d.id === 'airport')!.labelAt, undefined);
  // An authored label still inside its district is kept as authored.
  const kept = game.spec.districts.filter((d) => d.labelAt);
  assert.ok(kept.length >= 1, 'some authored label_at survives');
  for (const d of kept) assert.deepEqual(d.labelAt, spec.districts.find((a) => a.id === d.id)!.labelAt);
});

test('the walk graph of the real world is one piece: the derived district grid leaves no sidewalk islands in Act 1', () => {
  // The game runs on the saved Studio edits (specs/map/procedural-edits.json): same isthmus as tests/sector-slice.test.ts.
  const edited = parseWorldWithEdits(yaml, readFileSync(new URL('../specs/map/procedural-edits.json', import.meta.url), 'utf8'));
  const w = buildWorldData(yaml, generateIsthmus(edited)).walkGraph;
  const seen = new Array<boolean>(w.nodes.length).fill(false);
  const sizes: number[] = [];
  for (let s = 0; s < w.nodes.length; s++) {
    if (seen[s]) continue;
    seen[s] = true;
    let n = 0;
    const stack = [s];
    while (stack.length) {
      const u = stack.pop()!;
      n++;
      for (const e of w.adjacency[u]!) {
        const ed = w.edges[e]!;
        const v = ed.a === u ? ed.b : ed.a;
        if (!seen[v]) {
          seen[v] = true;
          stack.push(v);
        }
      }
    }
    sizes.push(n);
  }
  assert.ok(w.nodes.length > 100, `${w.nodes.length} walk nodes`);
  assert.equal(sizes.length, 1, `walk components (node counts): ${sizes.sort((a, b) => b - a).join(', ')}`);
});
