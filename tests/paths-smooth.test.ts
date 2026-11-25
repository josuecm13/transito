/**
 * Guard for smoothAvoiding (src/world/proc/paths.ts): the smoothed line must not cross a blocked
 * cell between its vertices. Mutation-checked: reverting the segment walk to a vertex-only check
 * turns the first test red.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellAt, mask, type GridShape } from '../src/world/proc/grid.ts';
import { leastCostPath, smoothAvoiding } from '../src/world/proc/paths.ts';

const g: GridShape = { w: 20, h: 20, cell: 10 };

/** Dense sampling of every segment; independent of the implementation's walk. */
function crossedBlocked(pts: readonly { x: number; y: number }[], blocked: Uint8Array): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    for (let t = 0; t <= 400; t++) {
      const x = a.x + ((b.x - a.x) * t) / 400;
      const y = a.y + ((b.y - a.y) * t) / 400;
      if (blocked[cellAt(g, x, y)]) return true;
    }
  }
  return false;
}

test('smoothAvoiding: no segment crosses a blocked cell the route went around', () => {
  const blocked = mask(g);
  // Three isolated lake cells; the routed cell path (itself clear of them) is a long, gently bent
  // line, so Douglas-Peucker leaves long segments whose dry vertices straddle a blocked cell.
  for (const [x, y] of [[7, 3], [5, 12], [11, 16]] as const) blocked.data[y * g.w + x] = 1;
  const from = { x: 5, y: 35 }; // cell (0, 3), dry
  const to = { x: 195, y: 5 }; // cell (19, 0), dry
  const cells = leastCostPath(g, from, to, (_a, b, len, mid) => (blocked.data[b] || blocked.data[mid] ? Infinity : len), 1);
  assert.ok(cells.length > 0);
  assert.ok(cells.every((c) => !blocked.data[c]), 'routed cells avoid the blocked cell');
  const pts = smoothAvoiding(g, cells, blocked, from, to);
  assert.ok(pts.every((q) => !blocked.data[cellAt(g, q.x, q.y)]), 'vertices dry');
  assert.deepEqual(pts[0], from);
  assert.deepEqual(pts[pts.length - 1], to);
  assert.equal(crossedBlocked(pts, blocked.data), false, 'segments stay out of blocked cells');
});

test('smoothAvoiding: a clip already present in the raw path does not force the raw fallback', () => {
  const blocked = mask(g);
  blocked.data[8 * g.w + 2] = 1;
  // Raw knight move (1,8) -> (3,9) clips the corner of blocked cell (2,8); that is the router's, not the smoothing's.
  const xy: [number, number][] = [[0, 8], [1, 8], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9]];
  const cells = xy.map(([x, y]) => y * g.w + x);
  const pts = smoothAvoiding(g, cells, blocked);
  assert.notEqual(pts.length, cells.length, 'smoothed, not the raw cell centres');
  const raw = cells.map((c) => ({ x: ((c % g.w) + 0.5) * g.cell, y: (Math.floor(c / g.w) + 0.5) * g.cell }));
  const rawHits = new Set<number>();
  const visit = (p: readonly { x: number; y: number }[], into: Set<number>): void => {
    for (let i = 1; i < p.length; i++)
      for (let t = 0; t <= 400; t++) {
        const c = cellAt(g, p[i - 1]!.x + ((p[i]!.x - p[i - 1]!.x) * t) / 400, p[i - 1]!.y + ((p[i]!.y - p[i - 1]!.y) * t) / 400);
        if (blocked.data[c]) into.add(c);
      }
  };
  const smoothHits = new Set<number>();
  visit(raw, rawHits);
  visit(pts, smoothHits);
  assert.ok(rawHits.size > 0, 'fixture: the raw path does clip the blocked cell');
  for (const c of smoothHits) assert.ok(rawHits.has(c), 'smoothing introduced no new blocked cell');
});
