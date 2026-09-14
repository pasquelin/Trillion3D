import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransport,
  solveTransportOracle,
  LightingTransportError,
} from './lightingTransport.ts';
import { sceneWithBlocker } from '../../test/fixtures/lightingTransportScene.ts';
test('cached static intersections preserve the complete operator through blocker moves and relighting', () => {
  const firstScene = sceneWithBlocker(false, 1);
  const options = { raysPerPatch: 64, maxIterations: 128, tolerance: 1e-10 };
  const rebuilt = createTransport(firstScene, options),
    reused = createTransport(firstScene, options);
  let previousSnapshot: ReturnType<typeof reused.snapshot> | undefined;
  let previousMatrix: Float64Array | undefined;
  for (const [open, intensity, geometryChanges] of [
    [false, 1, true],
    [true, 1, true],
    [true, 2, false],
    [false, 2, true],
    [true, 0.37, true],
  ] as const) {
    const scene = sceneWithBlocker(open, intensity);
    const full = rebuilt.update(scene, 'rebuild'),
      cached = reused.update(scene, 'reuse');
    const fullSnapshot = rebuilt.snapshot(),
      cachedSnapshot = reused.snapshot();
    assert.deepEqual(
      cachedSnapshot.matrix,
      fullSnapshot.matrix,
      'reuse must retain the exact same sampled transport',
    );
    assert.equal(full.converged, true);
    assert.equal(cached.converged, true);
    const oracle = solveTransportOracle(fullSnapshot);
    assert.ok(oracle.residual < 1e-12);
    for (let i = 0; i < oracle.radiance.length; i++) {
      assert.ok(Math.abs(full.radiance[i] - oracle.radiance[i]) <= full.errorBound + 1e-12);
      assert.ok(Math.abs(cached.radiance[i] - oracle.radiance[i]) <= cached.errorBound + 1e-12);
      assert.ok(
        Math.abs(full.radiance[i] - cached.radiance[i]) <=
          full.errorBound + cached.errorBound + 1e-12,
      );
      assert.ok(cached.irradiance[i] >= 0 && Number.isFinite(cached.irradiance[i]));
    }
    for (let row = 0; row < cachedSnapshot.patchCount; row++) {
      let sum = 0;
      for (let column = 0; column < cachedSnapshot.patchCount; column++) {
        const coefficient = cachedSnapshot.matrix[row * cachedSnapshot.patchCount + column];
        assert.ok(coefficient >= 0);
        sum += coefficient;
      }
      assert.ok(sum <= 1, 'escaped and absorbed rays must never create energy');
      for (let channel = 0; channel < 3; channel++) {
        const at = row * 3 + channel;
        const reconstructed =
          cachedSnapshot.source[at] + (cachedSnapshot.albedo[at] * cached.irradiance[at]) / Math.PI;
        assert.ok(
          Math.abs(reconstructed - cached.radiance[at]) <= cached.residual + 1e-12,
          'irradiance has the required pi factor',
        );
      }
    }
    const receiverLight =
      cached.radiance[0] + cached.radiance[3] + cached.radiance[6] + cached.radiance[9];
    if (open) assert.ok(receiverLight > 0.01, 'opening must rediscover the emitter');
    else assert.ok(receiverLight < options.tolerance * 4, 'closing must extinguish the receiver');
    assert.equal(full.raysTraced, full.totalRays);
    if (previousSnapshot) {
      assert.ok(cached.raysReused > 0);
      assert.deepEqual(
        previousSnapshot.matrix,
        previousMatrix,
        'oracle snapshots own their arrays',
      );
    }
    if (!geometryChanges) {
      assert.equal(cached.raysTraced, 0);
      assert.equal(cached.movingRayTests, 0);
      assert.equal(cached.rowsUpdated, 0);
    }
    previousSnapshot = cachedSnapshot;
    previousMatrix = cachedSnapshot.matrix.slice();
  }
});

test('canonical solver initialization makes full and reused transport byte-identical through scene changes', () => {
  const initial = sceneWithBlocker(false, 1);
  const options = { raysPerPatch: 64, tolerance: 1e-8, warmStart: false };
  const rebuilt = createTransport(initial, options),
    reused = createTransport(initial, options);
  for (const [open, intensity] of [
    [false, 1],
    [true, 1],
    [true, 0.37],
    [false, 0.37],
    [true, 0],
    [true, 2],
  ] as const) {
    const scene = sceneWithBlocker(open, intensity);
    const full = rebuilt.update(scene, 'rebuild'),
      cached = reused.update(scene, 'reuse');
    assert.equal(full.converged, true);
    assert.equal(cached.converged, true);
    assert.deepEqual(cached.radiance, full.radiance);
    assert.deepEqual(cached.irradiance, full.irradiance);
    assert.deepEqual(cached.indirectIrradiance, full.indirectIrradiance);
    assert.equal(cached.iterations, full.iterations);
    assert.equal(cached.residual, full.residual);
  }
});

test('cancellation never publishes a partial operator and a retry rebuilds it', () => {
  let cancelled = false,
    interrupt = true;
  const scene = sceneWithBlocker(true, 1);
  const state = createTransport(scene, {
    cancelled: () => cancelled,
    onProgress: (event) => {
      if (interrupt && event.stage === 'visibility') cancelled = true;
    },
  });
  assert.throws(
    () => state.update(scene, 'reuse'),
    (error: unknown) => error instanceof LightingTransportError && error.code === 'CANCELLED',
  );
  assert.throws(
    () => state.snapshot(),
    (error: unknown) => error instanceof LightingTransportError && error.code === 'NOT_READY',
  );
  cancelled = false;
  interrupt = false;
  const result = state.update(scene, 'reuse');
  assert.equal(result.converged, true);
  assert.equal(result.raysTraced, result.totalRays);
});
