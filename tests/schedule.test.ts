import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderPlugins } from '../src/ecs/schedule.ts';

const p = (name: string, dependsOn?: string[]) => ({ name, dependsOn });
const names = (l: { name: string }[]) => l.map((x) => x.name);

test('dependencies come first', () => {
  assert.deepEqual(names(orderPlugins([p('a', ['b']), p('b', ['c']), p('c')])), ['c', 'b', 'a']);
});

test('ties keep input order', () => {
  assert.deepEqual(names(orderPlugins([p('x'), p('y'), p('z')])), ['x', 'y', 'z']);
  assert.deepEqual(names(orderPlugins([p('x', ['z']), p('y'), p('z')])), ['z', 'x', 'y']);
});

test('unknown dependency names it', () => {
  assert.throws(() => orderPlugins([p('a', ['ghost'])]), /ghost/);
});

test('cycle names the cycle', () => {
  assert.throws(
    () => orderPlugins([p('a', ['b']), p('b', ['c']), p('c', ['a'])]),
    /a -> b -> c -> a/,
  );
});
