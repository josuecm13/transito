/**
 * Issue #7: "Las calles nuevas se conectan a [las avenidas] en T o en cruz, sin quedar flotando".
 * A dead end whose carriageway reaches into another street is an overlap, not a junction: the
 * generator closes it (closeTouchingDeadEnds) and links walk islands hanging from the highway
 * (linkWalkIslands). Checked with the brute-force validators of streets-check.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import type { EdgeProps, StreetPlacementCheck } from '../src/world/streets/index.ts';
import { closeTouchingDeadEnds, DEFAULT_PARAMS, generateStreets, linkWalkIslands, PlanarGraph } from '../src/world/streets/index.ts';
import { joinTouchingDeadEnds } from '../src/world/walk-graph.ts';
import { checkPlanarity, penetratingDeadEnds, streetComponents, walkIslands } from './streets-check.ts';

const spec = parseWorldSpec(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
const slice = sliceWorld(spec);

const avenue: EdgeProps = { cls: 'avenue', width: 14, sidewalk: 3, fixed: true, routeId: 'r' };
const highway: EdgeProps = { cls: 'avenue', width: 24, sidewalk: 0, fixed: true, routeId: 'h' };
const local: EdgeProps = { cls: 'local', width: 7, sidewalk: 2, fixed: false, district: 'd' };
const anywhere: StreetPlacementCheck = (p) => !p.fixed;

test('real area, seeds 1..5: no dead end inside another street, no walk island; the walk-graph join is a no-op', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const net = generateStreets(spec, slice, { seed });
    assert.deepEqual(penetratingDeadEnds(net.graph), [], `seed ${seed}`);
    assert.deepEqual(walkIslands(net.graph), [], `seed ${seed}: walk islands`);
    if (seed === spec.streetStyles.seed) assert.deepEqual(joinTouchingDeadEnds(net.graph), net.graph, 'joinTouchingDeadEnds changed the network');
  }
});

test('checker: flags an end inside a street or near its node, not a real T or the stub\'s own continuation', () => {
  const g = new PlanarGraph();
  g.addPolyline([{ x: 0, y: 0 }, { x: 200, y: 0 }], avenue);
  g.addSegment({ x: 50, y: 60 }, { x: 50, y: 0 }, local); // real T
  g.addSegment({ x: 120, y: 60 }, { x: 120, y: 8 }, local); // stops 8 m off: inside 7 + 3 + 3.5
  g.addSegment({ x: 160, y: 60 }, { x: 160, y: 20 }, local); // stops 20 m off: a real dead end
  const flagged = penetratingDeadEnds(g.snapshot());
  assert.equal(flagged.length, 1, flagged.join('\n'));
  assert.match(flagged[0]!, /\(120\.0,8\.0\)/);
  // A pinned avenue end with its own next segment within reach is not flagged.
  const h = new PlanarGraph();
  h.addPolyline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 100, y: 0 }], highway);
  assert.deepEqual(penetratingDeadEnds(h.snapshot()), []);
});

test('synthetic: a free end inside a street becomes a T on it; a pinned avenue end gets the street onto it', () => {
  const g = new PlanarGraph();
  g.addPolyline([{ x: 0, y: 0 }, { x: 200, y: 0 }], avenue);
  g.addSegment({ x: 120, y: 60 }, { x: 121, y: 6 }, local); // free end 6 m off the avenue
  // Avenue "e" ends (pinned) 2 m from a local that runs past it.
  g.addPolyline([{ x: 50, y: 100 }, { x: 50, y: 32 }], { ...avenue, routeId: 'e' });
  g.addPolyline([{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 0 }], local);
  const before = penetratingDeadEnds(g.snapshot());
  assert.equal(before.length, 2, before.join('\n'));
  const closed = closeTouchingDeadEnds(g, anywhere, DEFAULT_PARAMS);
  const snap = g.snapshot();
  assert.equal(closed, 2);
  assert.deepEqual(penetratingDeadEnds(snap), []);
  const r = checkPlanarity(snap);
  assert.deepEqual([r.crossings, r.closeNodes, r.nodeNearEdge, r.shortEdges], [[], [], [], []]);
  // The free end landed on the avenue centreline, along its own direction.
  assert.ok(snap.nodes.some((n) => Math.abs(n.y) < 1e-9 && Math.abs(n.x - (121 + 6 / 54)) < 1e-6), 'T on the avenue');
  // The pinned avenue end did not move and is now a T; the avenue keeps its geometry.
  const end = snap.nodes.find((n) => n.x === 50 && n.y === 32)!;
  assert.ok(end.pinned);
  const arms = snap.edges.filter((e) => e.cls !== 'frame' && (e.a === end.id || e.b === end.id));
  assert.equal(arms.length, 3);
  const avenueE = snap.edges.filter((e) => e.routeId === 'e');
  assert.equal(avenueE.length, 1);
  assert.ok(Math.abs(avenueE[0]!.length - 68) < 1e-9);
  // The cross street stays straight (translated, not bent) and is avenue-wide next to the T.
  for (const e of arms) if (e.routeId === undefined) assert.equal(e.width, avenue.width);
  assert.ok(snap.nodes.filter((n) => Math.abs(n.y - 32) < 1e-9).length >= 4, 'cross street moved onto y = 32');
});

test('synthetic: a local hanging from the highway alone is linked to the walkable network', () => {
  const g = new PlanarGraph();
  g.addPolyline([{ x: 0, y: 0 }, { x: 300, y: 0 }], avenue);
  g.addPolyline([{ x: 0, y: 200 }, { x: 300, y: 200 }], highway);
  g.addSegment({ x: 150, y: 0 }, { x: 150, y: 80 }, local); // from the avenue
  g.addSegment({ x: 40, y: 200 }, { x: 110, y: 130 }, local); // from the highway only, ends 64 m off
  assert.equal(walkIslands(g.snapshot()).length, 1);
  assert.equal(linkWalkIslands(g, anywhere, DEFAULT_PARAMS), 1);
  const snap = g.snapshot();
  assert.deepEqual(walkIslands(snap), []);
  assert.equal(streetComponents(snap).length, 1);
  const r = checkPlanarity(snap);
  assert.deepEqual([r.crossings, r.closeNodes, r.nodeNearEdge, r.shortEdges], [[], [], [], []]);
});
