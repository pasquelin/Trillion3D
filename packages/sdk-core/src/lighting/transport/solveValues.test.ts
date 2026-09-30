import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportState } from './state.ts';
import { solveTransport } from './solve.ts';
import {
  sceneFromSurfaces,
  sceneWithBlocker,
} from '../../../../../tests/fixtures/lightingTransportScene.ts';

function onePatch() {
  const surface = sceneWithBlocker(false, 1).surfaces[0];
  const state = createTransportState(sceneFromSurfaces([{ ...surface, columns: 1, rows: 1 }]), {
    maxIterations: 1,
    tolerance: 0.25,
  });
  state.matrix[0] = 0.5;
  state.rowSums[0] = 0.5;
  state.albedo.set([0.2, 0.5, 0.8]);
  state.source.set([1, 2, 3]);
  return state;
}

test('finite iteration budget reports remaining error and warm starts use previous radiance', () => {
  for (const [mode, initialized, warmStart, expected] of [
    ['reuse', true, true, [2, 7, 15]],
    ['reuse', false, true, [1, 2, 3]],
    ['rebuild', true, true, [1, 2, 3]],
    ['reuse', true, false, [1, 2, 3]],
  ] as const) {
    const state = onePatch();
    state.initialized = initialized;
    state.radiance.set([10, 20, 30]);
    const result = solveTransport(state, mode, { warmStart });
    assert.deepEqual([...state.radiance], expected);
    assert.equal(result.iterations, 1);
    assert.equal(result.contraction, 0.4);
    assert.equal(result.converged, false);
    assert.ok(result.errorBound > state.tolerance);
    assert.deepEqual(
      [...state.irradiance],
      expected.map((value) => (Math.PI * value) / 2),
    );
    assert.deepEqual(
      [...state.indirectIrradiance],
      expected.map((value, index) => (Math.PI * (value - index - 1)) / 2),
    );
  }
});

test('solver rejects noncontractive and overflowing transport with structured diagnostics', () => {
  for (const channel of [0, 1, 2]) {
    const state = onePatch();
    state.rowSums[0] = 1;
    state.albedo[channel] = 1;
    assert.throws(
      () => solveTransport(state, 'rebuild', {}),
      (error: any) =>
        error.code === 'NON_CONTRACTIVE_TRANSPORT' && error.message.includes('strict maximum'),
    );
  }
  for (const channel of [0, 1, 2]) {
    const state = onePatch();
    state.source[channel] = Infinity;
    assert.throws(
      () => solveTransport(state, 'rebuild', {}),
      (error: any) =>
        error.code === 'NUMERICAL_OVERFLOW' && error.message.includes('finite arithmetic'),
    );
  }
  let calls = 0;
  assert.throws(
    () => solveTransport(onePatch(), 'rebuild', { cancelled: () => ++calls === 3 }),
    (error: any) => error.code === 'CANCELLED',
  );
});

test('solver progress reports intermediate work and terminates at the requested error bound', () => {
  const state = onePatch();
  state.maxIterations = 40;
  state.tolerance = 1e-13;
  const events: unknown[] = [];
  const result = solveTransport(state, 'rebuild', { onProgress: (event) => events.push(event) });
  assert.deepEqual(
    events,
    [0, 16, 32, result.iterations].map((completed) => ({
      eventVersion: 1,
      stage: 'solve',
      completed,
      total: 40,
    })),
  );
  assert.equal(result.converged, true);
  for (const [index, expected] of [10 / 9, 8 / 3, 5].entries())
    assert.ok(Math.abs(state.radiance[index] - expected) < 1e-12);
});

test('exact convergence boundary admits the bound and avoids an unnecessary extra iteration', () => {
  const state = onePatch();
  state.maxIterations = 10;
  state.matrix[0] = 0.5;
  state.rowSums[0] = 0.5;
  state.albedo.fill(1);
  state.source.fill(1);
  state.tolerance = 1;
  const result = solveTransport(state, 'rebuild', {});
  assert.equal(result.iterations, 2);
  assert.equal(result.errorBound, 0.5);
  assert.equal(result.converged, true);
  const capped = onePatch();
  capped.albedo.fill(1);
  capped.source.fill(1);
  capped.tolerance = 1;
  const last = solveTransport(capped, 'rebuild', {});
  assert.equal(last.errorBound, 1);
  assert.equal(last.converged, true);
});
