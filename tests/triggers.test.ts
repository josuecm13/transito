import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateTrigger } from '../src/sim/triggers.ts';

test('enters when distance <= radius', () => {
  assert.deepEqual(updateTrigger(false, 5, 5, 2), { inside: true, event: 'enter' });
  assert.deepEqual(updateTrigger(false, 5.01, 5, 2), { inside: false, event: null });
});

test('stays inside without events', () => {
  assert.deepEqual(updateTrigger(true, 1, 5, 2), { inside: true, event: null });
});

test('exits only beyond radius + hysteresis', () => {
  assert.deepEqual(updateTrigger(true, 7.01, 5, 2), { inside: false, event: 'exit' });
});

test('no flicker inside the hysteresis band', () => {
  let s = { inside: false, event: null as 'enter' | 'exit' | null };
  const events: string[] = [];
  for (const d of [6, 5, 5.5, 6.9, 5.1, 6.5, 7, 5.2]) {
    s = updateTrigger(s.inside, d, 5, 2);
    if (s.event) events.push(s.event);
  }
  assert.deepEqual(events, ['enter']);
  assert.equal(s.inside, true);
});
