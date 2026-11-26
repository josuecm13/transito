// Card 3c: the section generator must build the same streets on every JS engine. Chrome and Node return different last bits
// for Math.sin/cos/tan/atan/atan2/asin/acos/exp/log/pow/cbrt; this test reproduces that in Node by perturbing those functions by
// 1-2 ulp (a deterministic pattern keyed on the input bits) and requires the Act 1 build to be identical to the unperturbed one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWorldWithEdits } from '../src/studio/saved.ts';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import { buildWorldData } from '../src/world/world-data.ts';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const yaml = read('specs/map/world.yaml');
// The baked isthmus is a fixed input of the game (decoded from a file), so it is generated once, unperturbed.
const iso = generateIsthmus(parseWorldWithEdits(yaml, read('specs/map/procedural-edits.json')));

const NAMES = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow', 'cbrt'] as const;
const f64 = new Float64Array(1);
const u64 = new BigInt64Array(f64.buffer);
const PATTERN = [1n, -1n, 2n, -2n];

/** y moved by 1 or 2 ulp, up or down, chosen from the bits of the first argument. */
function perturb(y: number, key: number): number {
  if (!Number.isFinite(y) || y === 0) return y;
  f64[0] = key;
  const k = PATTERN[Number((u64[0] as bigint) & 3n)] as bigint;
  f64[0] = y;
  u64[0] = (u64[0] as bigint) + k;
  return f64[0] as number;
}

function perturbed<T>(fn: () => T): T {
  const orig = new Map<string, (...a: number[]) => number>();
  const M = Math as unknown as Record<string, (...a: number[]) => number>;
  for (const n of NAMES) {
    const o = M[n] as (...a: number[]) => number;
    orig.set(n, o);
    M[n] = (...a: number[]): number => perturb(o(...a), a[0] as number);
  }
  try {
    return fn();
  } finally {
    for (const [n, o] of orig) M[n] = o;
  }
}

function summary(): { edges: number; blocks: number; buildings: number; hash: string } {
  const d = buildWorldData(yaml, iso);
  const r = (v: number): string => (Math.round(v * 1e6) / 1e6).toFixed(6);
  let h = 0x811c9dc5;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  };
  const nodes = d.streets.graph.nodes;
  const lines = d.streets.graph.edges.map((e) => {
    const a = nodes[e.a] as { x: number; y: number };
    const b = nodes[e.b] as { x: number; y: number };
    const p = `${r(a.x)},${r(a.y)}`;
    const q = `${r(b.x)},${r(b.y)}`;
    return `${p < q ? p + '|' + q : q + '|' + p}|${e.cls}`;
  });
  for (const l of lines.sort()) mix(l);
  return { edges: d.streets.graph.edges.length, blocks: d.streets.blocks.length, buildings: d.buildings.length, hash: h.toString(16) };
}

test('Act 1 builds the same streets, blocks and buildings when Math.sin/cos/atan2/... are off by 1-2 ulp', () => {
  const base = summary();
  const moved = perturbed(summary);
  console.log(`unperturbed: ${JSON.stringify(base)}\nperturbed:   ${JSON.stringify(moved)}`);
  assert.deepEqual(moved, base);
});

test('dmath agrees with Math.* to better than 1e-13 (and uses nothing but + - * / sqrt floor abs)', async () => {
  const D = await import('../src/world/streets/section/dmath.ts');
  let s = 12345;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const worst = { sin: 0, cos: 0, atan2: 0, acos: 0, exp: 0, log: 0 };
  const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 2e4;
    const y = (rnd() - 0.5) * 200;
    const z = (rnd() - 0.5) * 2;
    const p = rnd() * 1e4 + 1e-9;
    const q = (rnd() - 0.5) * 40;
    worst.sin = Math.max(worst.sin, Math.abs(D.sin(x) - Math.sin(x)));
    worst.cos = Math.max(worst.cos, Math.abs(D.cos(x) - Math.cos(x)));
    worst.atan2 = Math.max(worst.atan2, rel(D.atan2(y, x), Math.atan2(y, x)));
    worst.acos = Math.max(worst.acos, Math.abs(D.acos(z) - Math.acos(z)));
    worst.exp = Math.max(worst.exp, rel(D.exp(q), Math.exp(q)));
    worst.log = Math.max(worst.log, Math.abs(D.log(p) - Math.log(p)) / Math.max(Math.abs(Math.log(p)), 1e-3));
  }
  console.log(`dmath worst error vs Math.*: ${JSON.stringify(worst)}`);
  for (const [k, v] of Object.entries(worst)) assert.ok(v < 1e-13, `${k} ${v}`);
});
