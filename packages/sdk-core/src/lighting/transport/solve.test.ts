import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransport,
  LightingTransportError,
  LIGHTING_TRANSPORT_ALGORITHM_VERSION,
} from './transport.ts';
import { solveTransportOracle } from './oracle.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';
import { solveTransport } from './solve.ts';
import { oracle, traced } from './solve.fixture.ts';
import { neighbours } from './intersections.fixture.ts';
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

test('the radiance lies within its error bound of the direct solution, whatever the budget', () => {
  for (const maxIterations of [1, 2, 5, 20, 256]) {
    const state = traced([0.8, 0.5, 0.3], { maxIterations, tolerance: 1e-9 });
    const result = solveTransport(state, 'rebuild', {});
    const exact = oracle(state);
    assert.ok(result.iterations >= 1 && result.iterations <= maxIterations);
    state.radiance.forEach((value, i) =>
      assert.ok(Math.abs(value - exact[i]) <= result.errorBound + 1e-15, `${maxIterations} ${i}`),
    );
    assert.equal(result.converged, result.errorBound <= 1e-9);
    if (maxIterations === 2) assert.equal(result.converged, false);
    if (maxIterations === 256) assert.equal(result.converged, true);
    assert.ok(result.residual >= 0 && result.errorBound >= result.residual);
  }
});

test('irradiance gathers all light, indirect irradiance all but the emitted part', () => {
  const state = traced([0.8, 0.5, 0.3], { tolerance: 1e-12 });
  solveTransport(state, 'rebuild', {});
  for (let i = 0; i < state.size; i++)
    for (let channel = 0; channel < 3; channel++) {
      let all = 0,
        reflected = 0;
      for (let j = 0; j < state.size; j++) {
        const share = state.matrix[i * state.size + j];
        all += share * state.radiance[j * 3 + channel];
        reflected += share * (state.radiance[j * 3 + channel] - state.source[j * 3 + channel]);
      }
      const at = i * 3 + channel;
      assert.ok(Math.abs(state.irradiance[at] - Math.PI * all) < 1e-12);
      assert.ok(Math.abs(state.indirectIrradiance[at] - Math.PI * reflected) < 1e-12);
    }
  // The emitting ceiling also receives light the walls reflect.
  const ceiling = state.size - 4 * 3;
  assert.ok(state.indirectIrradiance[ceiling * 3] > 0);
});

test('a reused solved state starts from its last radiance unless told to start cold', () => {
  const cold = solveTransport(
    traced([0.8, 0.5, 0.3], { tolerance: 1e-9 }),
    'rebuild',
    {},
  ).iterations;
  assert.ok(cold > 1);
  for (const [mode, initialized, warmStart, expected] of [
    ['reuse', true, undefined, 1],
    ['reuse', true, true, 1],
    ['reuse', true, false, cold],
    ['reuse', false, true, cold],
    ['rebuild', true, true, cold],
  ] as const) {
    const state = traced([0.8, 0.5, 0.3], { tolerance: 1e-9 });
    solveTransport(state, 'rebuild', {});
    state.initialized = initialized;
    assert.equal(
      solveTransport(state, mode, { warmStart }).iterations,
      expected,
      `${mode} ${initialized} ${warmStart}`,
    );
  }
});

test('the solver stops on the first bounce within its share of the tolerance, exactly on it too', () => {
  const albedo: [number, number, number] = [0.8, 0.8, 0.8];
  const { contraction } = solveTransport(traced(albedo), 'rebuild', {});
  // From darkness the first bounce moves the radiance by the brightest emission.
  const first = Math.max(...traced(albedo).source);
  const tolerance = [...neighbours(first / (1 - contraction), 64)].find(
    (value) => value * (1 - contraction) === first,
  );
  assert.ok(tolerance, 'no tolerance puts the first bounce exactly on its share');
  assert.equal(
    solveTransport(traced(albedo, { maxIterations: 5, tolerance }), 'rebuild', {}).iterations,
    1,
  );
});

test('a solve whose error bound equals the tolerance has converged', () => {
  const albedo: [number, number, number] = [0.8, 0.5, 0.3];
  const { errorBound } = solveTransport(traced(albedo, { maxIterations: 1 }), 'rebuild', {});
  const result = solveTransport(
    traced(albedo, { maxIterations: 1, tolerance: errorBound }),
    'rebuild',
    {},
  );
  assert.deepEqual([result.errorBound, result.converged], [errorBound, true]);
});
