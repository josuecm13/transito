import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HeightGrid } from '../src/world/height-grid.ts';
import { COVER_MAP_COLORS, coverColor, gridHeight, hillshadeAt, pixelFrame, pixelToSpec, shadedCoverColor, shadeFactor, specToPixel } from '../src/sim/map-layers.ts';

/** Plane z = a*x + b*y on a 20 x 20 grid of 10 m cells. */
function plane(a: number, b: number): HeightGrid {
  const cols = 20;
  const rows = 20;
  const data = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) data[j * cols + i] = a * i * 10 + b * j * 10;
  return { x0: 0, y0: 0, cell: 10, cols, rows, data };
}

test('flat ground shades at 45 degrees light (0.7071) and leaves the colour unchanged', () => {
  const s = hillshadeAt(plane(0, 0), 100, 100);
  assert.ok(Math.abs(s - Math.SQRT1_2) < 1e-6, String(s));
  assert.ok(Math.abs(shadeFactor(s) - 1) < 1e-6);
});

test('hillshade: north-west facing slope is brighter than south-east facing slope', () => {
  const nwFacing = hillshadeAt(plane(0.3, -0.3), 100, 100); // rises to the SE, so it faces NW (toward the light)
  const seFacing = hillshadeAt(plane(-0.3, 0.3), 100, 100); // rises to the NW, faces SE
  assert.ok(nwFacing > Math.SQRT1_2, `NW-facing ${nwFacing}`);
  assert.ok(seFacing < Math.SQRT1_2, `SE-facing ${seFacing}`);
  assert.ok(nwFacing > seFacing);
});

test('gridHeight interpolates bilinearly and clamps outside the grid', () => {
  const g = plane(0.1, 0.2);
  assert.ok(Math.abs(gridHeight(g, 55, 35) - (0.1 * 55 + 0.2 * 35)) < 1e-4);
  assert.equal(gridHeight(g, -500, -500), gridHeight(g, 0, 0));
});

test('cover colours: water is the sea blue, forest is darker than clearing, every class has a colour', () => {
  assert.deepEqual(coverColor('water'), [0x1d, 0x4e, 0x7a]);
  const lum = (c: readonly number[]): number => (c[0] as number) + (c[1] as number) * 2 + (c[2] as number);
  assert.ok(lum(coverColor('forest')) < lum(coverColor('clearing')));
  for (const name of ['water', 'mangrove', 'forest', 'clearing', 'grass', 'urban_prior', 'park_reclaimed']) assert.ok(name in COVER_MAP_COLORS, name);
  assert.ok(coverColor('urban_prior')[0] > coverColor('urban_prior')[2], 'settlements read grey-beige');
});

test('shaded cover: relief and density darken / lighten land, never the sea', () => {
  assert.ok(shadedCoverColor('forest', 0.3, 0.5)[1] < shadedCoverColor('forest', 0.9, 0.5)[1]);
  assert.ok(shadedCoverColor('forest', 0.7, 1)[1] < shadedCoverColor('forest', 0.7, 0)[1]);
  assert.deepEqual(shadedCoverColor('water', 0.1, 0), coverColor('water'));
});

test('pixel frame: north-up, round trip with pixel centres', () => {
  const f = pixelFrame({ minX: 0, minY: 0, maxX: 6000, maxY: 8000 }, 6);
  assert.equal(f.w, 1000);
  assert.equal(f.h, 1334);
  assert.deepEqual(specToPixel(f, 0, 8000), { x: 0, y: 0 });
  const c = pixelToSpec(f, 10, 20);
  const back = specToPixel(f, c.x, c.y);
  assert.ok(Math.abs(back.x - 10.5) < 1e-9 && Math.abs(back.y - 20.5) < 1e-9);
  assert.ok(specToPixel(f, 100, 7000).y < specToPixel(f, 100, 1000).y, 'north is up');
});
