// Card 8 (#13): a Save writes specs/map/procedural-edits.json, which the bake applies on top of world.yaml.
// The bake is cached by a hash of its inputs, so the edits file must be one of them or the game keeps the old map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputFiles } from '../tools/vite-isthmus.ts';
import { EDITS_FILE } from '../src/studio/saved.ts';

function project(withEdits: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'transito-bake-'));
  mkdirSync(join(root, 'specs/map'), { recursive: true });
  mkdirSync(join(root, 'src/world'), { recursive: true });
  writeFileSync(join(root, 'specs/map/world.yaml'), 'x: 1\n');
  writeFileSync(join(root, 'src/world/a.ts'), 'export {};\n');
  if (withEdits) writeFileSync(join(root, EDITS_FILE), '{"version":1,"edits":[]}\n');
  return root;
}

test('the saved edits file is a bake input when it exists, and absent inputs are not invented', () => {
  const a = project(true);
  const b = project(false);
  try {
    assert.ok(inputFiles(a).includes(join(a, EDITS_FILE)), 'procedural-edits.json must be hashed');
    assert.ok(!inputFiles(b).includes(join(b, EDITS_FILE)), 'no edits file, no input');
    assert.equal(inputFiles(b).length, 2);
  } finally {
    rmSync(a, { recursive: true });
    rmSync(b, { recursive: true });
  }
});
