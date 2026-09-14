import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransport,
  solveTransportOracle,
  LightingTransportError,
  LIGHTING_TRANSPORT_ALGORITHM_VERSION,
} from './lightingTransport.ts';
import { sceneWithBlocker } from '../../test/fixtures/lightingTransportScene.ts';
test('dense oracle matches the closed-form two-surface multiple-bounce solution', () => {
  const source = Float64Array.of(1, 2, 3, 4, 5, 6);
  const albedo = Float64Array.of(0.6, 0.3, 0.9, 0.4, 0.7, 0.2);
  const result = solveTransportOracle({
    formatVersion: 1,
    algorithmVersion: LIGHTING_TRANSPORT_ALGORITHM_VERSION,
    patchCount: 2,
    matrix: Float64Array.of(0, 0.5, 0.25, 0),
    source,
    albedo,
  });
  for (let channel = 0; channel < 3; channel++) {
    const a = albedo[channel] * 0.5,
      b = albedo[3 + channel] * 0.25;
    const first = (source[channel] + a * source[3 + channel]) / (1 - a * b);
    const second = source[3 + channel] + b * first;
    assert.ok(Math.abs(result.radiance[channel] - first) < 1e-12);
    assert.ok(Math.abs(result.radiance[3 + channel] - second) < 1e-12);
  }
  assert.ok(result.residual < 1e-12);
});

test('indirect irradiance excludes direct emission but retains reflections from emissive surfaces', () => {
  const scene = sceneWithBlocker(true, 1);
  const state = createTransport(scene, { raysPerPatch: 64, tolerance: 1e-10 });
  const result = state.update(scene, 'rebuild');
  const snapshot = state.snapshot();
  for (let row = 0; row < snapshot.patchCount; row++)
    for (let channel = 0; channel < 3; channel++) {
      let direct = 0;
      for (let column = 0; column < snapshot.patchCount; column++) {
        direct +=
          snapshot.matrix[row * snapshot.patchCount + column] *
          snapshot.source[column * 3 + channel];
      }
      const at = row * 3 + channel;
      assert.ok(result.indirectIrradiance[at] >= 0);
      assert.ok(
        Math.abs(result.irradiance[at] - result.indirectIrradiance[at] - Math.PI * direct) < 1e-12,
        'direct emission must appear exactly once when composing direct and indirect irradiance',
      );
    }
  assert.ok(
    result.indirectIrradiance[0] > 0,
    'the emitting surface also reflects light back to the receiver',
  );
  assert.throws(
    () => createTransport(scene, { raysPerPatch: 64, maxBytes: result.bytes - 1 }),
    (error: unknown) =>
      error instanceof LightingTransportError && error.code === 'MEMORY_BUDGET_EXCEEDED',
  );
  const admitted = createTransport(scene, { raysPerPatch: 64, maxBytes: result.bytes }).update(
    scene,
    'rebuild',
  );
  assert.equal(
    admitted.bytes,
    result.bytes,
    'the allocation estimate includes the new irradiance buffer exactly',
  );
});
