import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from './transport.ts';
import { createTransportState } from './state.ts';
import { solveTransport } from './solve.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';

test('an already cancelled update refuses work before validating newly supplied scene geometry', () => {
  const scene = sceneWithBlocker(true, 1);
  const transport = createTransport(scene, { cancelled: () => true });
  scene.patches[0].area = -1;
  assert.throws(
    () => transport.update(scene, 'rebuild'),
    (error: any) => error.code === 'CANCELLED',
  );
});

test('solver checks cancellation between successive bounces before advancing the next iterate', () => {
  const state = createTransportState(sceneWithBlocker(true, 1), {
    maxIterations: 20,
    tolerance: 1e-20,
  });
  state.matrix[0] = 0.5;
  state.rowSums[0] = 0.5;
  state.albedo.fill(0.5);
  state.source[0] = 1;
  assert.throws(
    () => solveTransport(state, 'rebuild', { cancelled: () => state.radiance[0] > 0 }),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.equal(state.radiance[0], 1);
});
