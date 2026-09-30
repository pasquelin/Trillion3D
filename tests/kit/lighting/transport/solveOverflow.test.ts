import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { solveTransport } from './solve.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';

test('finite radiance with an overflowing next-bounce residual still fails the numerical guard', () => {
  const state = createTransportState(sceneWithBlocker(true, 1), { maxIterations: 1 });
  state.matrix[0] = 0.5;
  state.rowSums[0] = 0.5;
  state.albedo.fill(0.8);
  state.source[0] = Number.MAX_VALUE;
  assert.throws(
    () => solveTransport(state, 'rebuild', {}),
    (error: any) => error.code === 'NUMERICAL_OVERFLOW',
  );
  assert.ok(state.radiance.every(Number.isFinite));
});
