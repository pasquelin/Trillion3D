import test from 'node:test';
import assert from 'node:assert/strict';
import type { TransportProgress } from './contracts.ts';
import type { Vec3 } from '../scene/experimentScene.ts';
import { solveTransport } from './solve.ts';
import { traced } from './solve.fixture.ts';

test('a closed box contracts by its largest albedo, and one reflecting all light is refused', () => {
  const state = traced([0.9, 0.5, 0.2]);
  assert.ok(state.rowSums.every((sum) => sum === 1));
  assert.equal(solveTransport(state, 'rebuild', {}).contraction, 0.9);
  for (let channel = 0; channel < 3; channel++) {
    const albedo: Vec3 = [0.5, 0.5, 0.5];
    albedo[channel] = 1;
    assert.throws(
      () => solveTransport(traced(albedo), 'rebuild', {}),
      (error: any) =>
        error.code === 'NON_CONTRACTIVE_TRANSPORT' && /contraction/.test(error.message),
    );
  }
});

test('the solver reports progress from zero to its last iteration, also while iterating', () => {
  const state = traced([0.95, 0.95, 0.95], { maxIterations: 500, tolerance: 1e-12 });
  const events: TransportProgress[] = [];
  const result = solveTransport(state, 'rebuild', { onProgress: (event) => events.push(event) });
  assert.ok(
    events.every(
      (event) => event.stage === 'solve' && event.total === 500 && event.eventVersion === 1,
    ),
  );
  const done = events.map((event) => event.completed);
  assert.deepEqual([done[0], done.at(-1)], [0, result.iterations]);
  assert.ok(
    done.every((value, i) => i === 0 || value > done[i - 1]),
    `${done}`,
  );
  assert.ok(
    done.some((value) => value > 0 && value < result.iterations),
    `${done}`,
  );
});

test('a cancellation requested after a bounce stops before the next one', () => {
  const state = traced([0.8, 0.5, 0.3]);
  assert.throws(
    () =>
      solveTransport(state, 'rebuild', {
        cancelled: () => state.radiance.some((value) => value > 0),
      }),
    (error: any) => error.code === 'CANCELLED',
  );
  // One bounce from darkness is the emission alone.
  assert.deepEqual(state.radiance, state.source);
});

test('radiance or a residual past finite arithmetic is refused', () => {
  for (const channel of [0, 1, 2]) {
    const emission: Vec3 = [1, 1, 1];
    emission[channel] = Number.MAX_VALUE;
    assert.throws(
      () => solveTransport(traced([0.9, 0.9, 0.9], {}, emission), 'rebuild', {}),
      (error: any) => error.code === 'NUMERICAL_OVERFLOW' && /finite/.test(error.message),
    );
  }
  const state = traced([0.9, 0.9, 0.9], { maxIterations: 1 }, [Number.MAX_VALUE, 1, 1]);
  assert.throws(
    () => solveTransport(state, 'rebuild', {}),
    (error: any) => error.code === 'NUMERICAL_OVERFLOW',
  );
  assert.ok(state.radiance.every(Number.isFinite));
});
