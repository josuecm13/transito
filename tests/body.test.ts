import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TITO_BODY, PEDESTRIAN_BODY, bodyHeight, centerY, type HumanBody } from '../src/sim/body.ts';

const root = join(import.meta.dirname, '..');
const EPS = 1e-9;

// Adult human range, meters.
const HEIGHT_TITO: [number, number] = [1.7, 1.9];
const HEIGHT_PED: [number, number] = [1.55, 1.85];
const WIDTH: [number, number] = [0.45, 0.8];
// Doorway or alley gap, and the character controller's skin offset (see player.ts).
const DOORWAY_GAP = 1.0;
const CONTROLLER_OFFSET = 0.05;

test('Tito is 1.70-1.90 m tall', () => {
  const h = bodyHeight(TITO_BODY);
  assert.ok(h >= HEIGHT_TITO[0] && h <= HEIGHT_TITO[1], `Tito height ${h} m outside ${HEIGHT_TITO}`);
});

test('pedestrians are 1.55-1.85 m tall', () => {
  const h = bodyHeight(PEDESTRIAN_BODY);
  assert.ok(h >= HEIGHT_PED[0] && h <= HEIGHT_PED[1], `pedestrian height ${h} m outside ${HEIGHT_PED}`);
});

test('each body is 0.45-0.80 m wide (2 * radius)', () => {
  for (const [name, b] of [
    ['Tito', TITO_BODY],
    ['pedestrian', PEDESTRIAN_BODY],
  ] as const) {
    const w = 2 * b.radius;
    assert.ok(w >= WIDTH[0] && w <= WIDTH[1], `${name} width ${w} m outside ${WIDTH}`);
  }
});

test('Tito fits through a 1.0 m doorway with the 0.05 m controller offset', () => {
  const clearance = 2 * (TITO_BODY.radius + CONTROLLER_OFFSET);
  assert.ok(clearance < DOORWAY_GAP, `Tito needs ${clearance} m, doorway is ${DOORWAY_GAP} m`);
});

test('centerY is half the body height (feet to capsule center)', () => {
  for (const b of [TITO_BODY, PEDESTRIAN_BODY] as HumanBody[]) {
    assert.ok(Math.abs(centerY(b) - bodyHeight(b) / 2) < EPS, `centerY ${centerY(b)} vs half height ${bodyHeight(b) / 2}`);
  }
});

// Source guard: the player and pedestrian plugins must take capsule dimensions from sim/body.ts.
// Regex: a CapsuleGeometry( or ColliderDesc.capsule( call whose first argument starts with a
// digit (optionally after whitespace or a minus sign). Identifiers like TITO_BODY.radius do not match.
const LITERAL_CAPSULE = /(CapsuleGeometry\(|ColliderDesc\.capsule\()\s*-?\d/;
for (const file of ['src/plugins/player.ts', 'src/plugins/pedestrians.ts']) {
  test(`${file} takes capsule dimensions from body.ts, not literals`, () => {
    const src = readFileSync(join(root, file), 'utf8');
    const m = LITERAL_CAPSULE.exec(src);
    assert.equal(m, null, `literal capsule dimension in ${file}: "${m?.[0]}"`);
  });
}
