import test from 'node:test';
import assert from 'node:assert/strict';
import { mustRestartTaaAfterSettle } from './converge.ts';

test('a quiet barrier leaves TAA history in place', () => {
  assert.equal(mustRestartTaaAfterSettle(0, 0), false);
});

test('tiles or shadow pages that landed during the barrier restart the still TAA average', () => {
  assert.equal(mustRestartTaaAfterSettle(1, 0), true);
  assert.equal(mustRestartTaaAfterSettle(0, 3), true);
});
