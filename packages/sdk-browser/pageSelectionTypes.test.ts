// Lot formules communes : ESCALATION_ROUNDS, factorisée de 2 copies (la coupe plate et la coupe du
// DAG de clusters escaladent le même nombre de fois).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';

test('ESCALATION_ROUNDS vaut trois tours de montée avant la couverture racine épinglée', () => {
  assert.equal(ESCALATION_ROUNDS, 3);
});

test('ESCALATION_ROUNDS borne une boucle « <= » à ESCALATION_ROUNDS + 1 tours, jamais zéro', () => {
  let rounds = 0;
  for (let round = 0; round <= ESCALATION_ROUNDS; round++) rounds++;
  assert.equal(rounds, ESCALATION_ROUNDS + 1);
  assert.ok(rounds > 0);
});
