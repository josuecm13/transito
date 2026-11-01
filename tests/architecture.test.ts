import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const PURE_DIRS = ['src/world', 'src/sim'];

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FORBIDDEN_SPECIFIER = /^(three(\/.*)?|@dimforge\/.*|miniplex)$/;
const FORBIDDEN_RELATIVE = /^(\.\.?\/)+(\.\.\/)*(engine|plugins|ui|ecs)(\/|$)/;
const FORBIDDEN_GLOBALS = /\b(document|window)\b/;

function violations(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const found: string[] = [];
  const spec = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(spec)) {
    const s = m[1] as string;
    if (FORBIDDEN_SPECIFIER.test(s)) found.push(`imports "${s}"`);
    if (FORBIDDEN_RELATIVE.test(s)) found.push(`imports layer above "${s}"`);
  }
  if (FORBIDDEN_GLOBALS.test(src)) found.push('references global document/window');
  return found;
}

test('src/world and src/sim stay pure (no engine, DOM, ecs, plugins, ui)', () => {
  const files = PURE_DIRS.flatMap((d) => tsFiles(join(root, d)));
  assert.ok(files.length > 0, 'scan found no files');
  const bad = files.flatMap((f) => violations(f).map((v) => `${relative(root, f)}: ${v}`));
  assert.deepEqual(bad, [], `layering violations:\n${bad.join('\n')}`);
});
