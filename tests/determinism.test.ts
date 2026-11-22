import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { assertDifferentData, assertSameData, digest } from './determinism.ts';

const fails = (fn: () => void, re: RegExp) => assert.throws(fn, (e: Error) => e.name === 'AssertionError' && re.test(e.message));

const sample = () => ({ city: { buildings: [{ center: { x: 1, y: 2 } }, { center: { x: 3, y: 4 } }], name: 'a' }, n: [1, 2, 3] });

test('equal nested structures pass; key order does not matter', () => {
  assertSameData(sample(), sample(), 'x');
  assertSameData({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }, 'x');
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
});

test('a deep leaf difference fails and names the exact path', () => {
  const b = sample();
  b.city.buildings[1]!.center.x = 3.5;
  fails(() => assertSameData(sample(), b, 'world'), /^world differs at city\.buildings\[1\]\.center\.x: 3 vs 3\.5$/);
});

test('array length, key set and type differences are differences at that path', () => {
  fails(() => assertSameData({ a: [1, 2] }, { a: [1, 2, 3] }, 'L'), /differs at a\.length: 2 vs 3/);
  fails(() => assertSameData({ a: 1 }, { a: 1, b: 2 }, 'L'), /differs at b: <missing> vs 2/);
  fails(() => assertSameData({ a: 1 }, { a: '1' }, 'L'), /differs at a: 1 vs '1'/);
  fails(() => assertSameData({ a: undefined }, { a: null }, 'L'), /differs at a/);
});

test('-0 differs from 0; NaN equals NaN', () => {
  fails(() => assertSameData({ v: -0 }, { v: 0 }, 'z'), /differs at v/);
  assertSameData({ v: NaN }, { v: NaN }, 'z');
});

test('Map and typed-array contents are compared', () => {
  assertSameData(new Map([['a', [1]]]), new Map([['a', [1]]]), 'm');
  fails(() => assertSameData({ m: new Map([['a', 1]]) }, { m: new Map([['a', 2]]) }, 'm'), /differs at m<value 0>: 1 vs 2/);
  assertSameData({ t: new Float64Array([1, 2]) }, { t: new Float64Array([1, 2]) }, 't');
  fails(() => assertSameData({ t: new Float64Array([1, 2]) }, { t: new Float64Array([1, 3]) }, 't'), /differs at t\[1\]: 2 vs 3/);
  fails(() => assertSameData({ t: new Uint8Array([1]) }, { t: new Int8Array([1]) }, 't'), /differs at t/);
});

test('a function inside throws a TypeError naming the path; a cycle throws a TypeError', () => {
  assert.throws(() => digest({ a: [{ f: () => 1 }] }), (e: Error) => e instanceof TypeError && e.message.includes('a[0].f'));
  const c: { self?: unknown } = {};
  c.self = c;
  assert.throws(() => digest({ c }), (e: Error) => e instanceof TypeError && e.message.includes('c.self'));
});

test('two 200 000-element arrays differing only in the last element fail with a short message', () => {
  const make = (last: number) => Array.from({ length: 200_000 }, (_, i) => ({ i, p: { x: i, y: i * 2 } }));
  const a = make(0);
  const b = make(0);
  (b[199_999] as { p: { x: number } }).p.x = -1;
  try {
    assertSameData({ list: a }, { list: b }, 'big');
    assert.fail('expected a difference');
  } catch (e) {
    const err = e as Error;
    assert.equal(err.name, 'AssertionError');
    assert.ok(err.message.length < 1000, `message length ${err.message.length}`);
    assert.match(err.message, /list\[199999\]\.p\.x: 199999 vs -1/);
    assert.equal((err as { actual?: unknown }).actual, undefined);
    assert.equal((err as { expected?: unknown }).expected, undefined);
  }
});

test('assertDifferentData fails on identical input and passes on different input', () => {
  fails(() => assertDifferentData(sample(), sample(), 'same'), /^same: expected different data, got identical \(digest [0-9a-f]{12}\)$/);
  assertDifferentData({ a: 1 }, { a: 2 }, 'diff');
});

test('determinismTest registers a skipped test without the env var, and runs it with it', () => {
  const mod = pathToFileURL(join(import.meta.dirname, 'determinism.ts')).href;
  const script = `import { determinismTest } from ${JSON.stringify(mod)}; determinismTest('probe', () => { console.log('PROBE-RAN'); });`;
  const run = (flag: string | undefined) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.TRANSITO_DETERMINISM;
    if (flag) env.TRANSITO_DETERMINISM = flag;
    return spawnSync(process.execPath, ['--input-type=module', '--test-reporter=tap', '-e', script], { env, encoding: 'utf8' });
  };
  const off = run(undefined);
  assert.equal(off.status, 0, off.stderr);
  assert.ok(!off.stdout.includes('PROBE-RAN'));
  assert.match(off.stdout, /determinism: probe/);
  assert.match(off.stdout, /SKIP/i);
  assert.match(off.stdout, /TRANSITO_DETERMINISM=1/);
  const on = run('1');
  assert.equal(on.status, 0, on.stderr);
  assert.ok(on.stdout.includes('PROBE-RAN'));
});
