import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices, createServiceKey } from '../src/ecs/services.ts';

const A = createServiceKey<number>('alpha');
const B = createServiceKey<string>('beta');

test('provide/get/has', () => {
  const s = createServices();
  assert.equal(s.has(A), false);
  s.provide(A, 42);
  assert.equal(s.has(A), true);
  assert.equal(s.get(A), 42);
});

test('get missing throws naming key and listing provided', () => {
  const s = createServices();
  s.provide(A, 1);
  assert.throws(() => s.get(B), (e: Error) => e.message.includes('beta') && e.message.includes('alpha'));
});

test('double provide throws', () => {
  const s = createServices();
  s.provide(A, 1);
  assert.throws(() => s.provide(A, 2), /alpha/);
});
