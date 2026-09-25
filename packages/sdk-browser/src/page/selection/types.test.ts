// ESCALATION_ROUNDS: the CPU cut's climb before its pinned root cover (`../cut/repair.ts`).
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
