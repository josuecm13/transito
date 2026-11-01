import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_LAYER } from '../src/world/index.ts';

test('world layer module loads', () => {
  assert.equal(WORLD_LAYER, 'world');
});
