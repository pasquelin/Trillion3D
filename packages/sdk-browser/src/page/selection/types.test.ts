// Shared-formula batch: ESCALATION_ROUNDS, factored out of 2 copies (the flat cut and the
// cluster-DAG cut escalate the same number of times).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESCALATION_ROUNDS } from './types.ts';

test('ESCALATION_ROUNDS is three climb rounds before the pinned root cover', () => {
  assert.equal(ESCALATION_ROUNDS, 3);
});

test('ESCALATION_ROUNDS bounds a "<= " loop to ESCALATION_ROUNDS + 1 rounds, never zero', () => {
  let rounds = 0;
  for (let round = 0; round <= ESCALATION_ROUNDS; round++) rounds++;
  assert.equal(rounds, ESCALATION_ROUNDS + 1);
  assert.ok(rounds > 0);
});
