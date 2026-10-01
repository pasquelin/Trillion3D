import test from 'node:test';
import assert from 'node:assert/strict';
import { SINGULAR_PIVOT, solveTransportOracle } from './oracle.ts';
import {
  LIGHTING_TRANSPORT_ALGORITHM_VERSION,
  LIGHTING_TRANSPORT_FORMAT_VERSION,
  type TransportProgress,
  type TransportSnapshot,
} from './contracts.ts';

/**
 * The snapshot whose radiance is `solution`: its source is `(I − albedo ⊙ matrix) · solution`, per
 * channel, so the oracle must return `solution` whatever pivots it takes.
 */
function system(matrix: number[], albedo: number[], solution: number[]): TransportSnapshot {
  const size = solution.length / 3;
  const source = solution.map((value, at) => {
    const row = Math.floor(at / 3),
      channel = at % 3;
    let sum = value;
    for (let j = 0; j < size; j++)
      sum -= albedo[at] * matrix[row * size + j] * solution[j * 3 + channel];
    return sum;
  });
  return {
    formatVersion: LIGHTING_TRANSPORT_FORMAT_VERSION,
    algorithmVersion: LIGHTING_TRANSPORT_ALGORITHM_VERSION,
    patchCount: size,
    matrix: Float64Array.from(matrix),
    source: Float64Array.from(source),
    albedo: Float64Array.from(albedo),
  };
}
const ones = (size: number) => Array.from({ length: size * 3 }, () => 1);
function solves(snapshot: TransportSnapshot, solution: number[], tolerance = 1e-12) {
  const result = solveTransportOracle(snapshot);
  result.radiance.forEach((value, i) =>
    assert.ok(
      Math.abs(value - solution[i]) <= tolerance * Math.max(1, Math.abs(solution[i])),
      `${i}: ${value} != ${solution[i]}`,
    ),
  );
  assert.ok(result.residual <= tolerance * 10, `${result.residual}`);
}
/** A pseudo-random generator, so a failing system can be rebuilt. */
const random = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

test('the oracle solves a single patch and a system with independent colour channels', () => {
  solves(system([0.5], [0.5, 0.2, 0.9], [4, 1, 7]), [4, 1, 7]);
  const triangular = [0, 0.5, 0, 0, 0, 0.25, 0, 0, 0];
  solves(
    system(
      triangular,
      [0.5, 0.25, 0.75, 0.5, 0.25, 0.75, 0.1, 0.2, 0.3],
      [2, 3, 4, 5, 6, 7, 8, 12, 16],
    ),
    [2, 3, 4, 5, 6, 7, 8, 12, 16],
  );
});

test('the oracle swaps rows when a pivot is zero, in the first column or a later one', () => {
  // With albedo 1, the system is I − matrix: these leave a zero on the diagonal at the first or second step.
  for (const matrix of [
    [1, 2, 3, 4],
    [-3, -1, -2, -2, 0.5, -3, -1, -1, 0],
    [-3, -1, -2, -2, 1, -1, -1, -3, 0],
  ]) {
    const size = Math.sqrt(matrix.length);
    const solution = Array.from({ length: size * 3 }, (_, i) => 1 + i);
    solves(system(matrix, ones(size), solution), solution);
  }
});

test('the oracle picks the largest pivot, keeping a badly scaled system accurate', () => {
  const matrix = [0, 10000, 0, 1, -9999, 0.0001, 1, 1e12, 0.99999999];
  solves(system(matrix, ones(3), [1, 1, 1, 2, 2, 2, 3, 3, 3]), [1, 1, 1, 2, 2, 2, 3, 3, 3], 1e-7);
  const next = random(7);
  for (let trial = 0; trial < 20; trial++) {
    const size = 2 + (trial % 7);
    const matrix = Array.from(
      { length: size * size },
      () => (next() - 0.5) * 10 ** Math.floor(next() * 6),
    );
    const solution = Array.from({ length: size * 3 }, () => next() * 4 - 2);
    solves(system(matrix, ones(size), solution), solution, 1e-6);
  }
});

test('a component that overflows leaves a disconnected emitter finite', () => {
  const result = solveTransportOracle({
    ...system([0, 0.9, 0, 0.9, 0, 0, 0, 0, 0], ones(3), ones(3)),
    source: Float64Array.from([1e308, 1e308, 1e308, 1e308, 1e308, 1e308, 1, 2, 3]),
  });
  assert.deepEqual([...result.radiance.slice(6)], [1, 2, 3]);
});

test('a pivot down to the singular limit is solved, one below it refused', () => {
  // I − matrix is [[0, 1], [pivot, 0]]: its solution is all ones for the source [1, pivot].
  const nearly = (pivot: number) => ({
    ...system([1, -1, -pivot, 1], ones(2), ones(2)),
    source: Float64Array.of(1, 1, 1, pivot, pivot, pivot),
  });
  solves(nearly(SINGULAR_PIVOT), ones(2));
  for (const snapshot of [
    nearly(SINGULAR_PIVOT / 2),
    system([1, 0, 0, 1], ones(2), ones(2)),
    system([0, 0, 0, 1], ones(2), ones(2)),
  ])
    assert.throws(
      () => solveTransportOracle(snapshot),
      (error: any) => error.code === 'SINGULAR_TRANSPORT' && /singular/.test(error.message),
    );
});

test('the oracle leaves its snapshot untouched', () => {
  const snapshot = system([1, 2, 3, 4], ones(2), [2, 3, 4, 4, 5, 6]);
  const saved = structuredClone(snapshot);
  solveTransportOracle(snapshot);
  assert.deepEqual(snapshot, saved);
});

test('the oracle refuses a snapshot of another format, a wrong size or a nonfinite value', () => {
  const valid = () => system([1, 2, 3, 4], ones(2), [2, 3, 4, 4, 5, 6]);
  for (const change of [
    { formatVersion: LIGHTING_TRANSPORT_FORMAT_VERSION + 1 },
    { algorithmVersion: '' },
    {
      patchCount: 0,
      matrix: new Float64Array(),
      source: new Float64Array(),
      albedo: new Float64Array(),
    },
    { patchCount: 1.5 },
    { patchCount: NaN },
    { patchCount: Number.MAX_SAFE_INTEGER + 1 },
    { matrix: new Float64Array(3) },
    { source: new Float64Array(5) },
    { albedo: new Float64Array(5) },
  ])
    assert.throws(
      () => solveTransportOracle({ ...valid(), ...change } as TransportSnapshot),
      (error: any) => error.code === 'INVALID_SNAPSHOT' && /Incompatible/.test(error.message),
    );
  for (const field of ['matrix', 'source', 'albedo'] as const)
    for (const value of [NaN, Infinity, -Infinity]) {
      const snapshot = valid();
      snapshot[field][snapshot[field].length - 1] = value;
      assert.throws(
        () => solveTransportOracle(snapshot),
        (error: any) => error.code === 'INVALID_SNAPSHOT' && /nonfinite/.test(error.message),
      );
    }
});

test('the oracle reports progress from zero to its total, now and then inside a long channel', () => {
  for (const size of [1, 2, 32, 40]) {
    const events: TransportProgress[] = [];
    solveTransportOracle(system(Array(size * size).fill(0.5 / size), ones(size), ones(size)), {
      onProgress: (event) => events.push(event),
    });
    assert.ok(
      events.every(
        (event) => event.stage === 'oracle' && event.total === size * 3 && event.eventVersion === 1,
      ),
    );
    const done = events.map((event) => event.completed);
    assert.deepEqual([done[0], done.at(-1)], [0, size * 3]);
    assert.ok(
      done.every((value, i) => i === 0 || value > done[i - 1]),
      `${done}`,
    );
    for (let channel = 0; channel < 3; channel++)
      assert.ok(done.includes(channel * size), `${size} ${done}`);
    if (size > 2) {
      assert.ok(
        done.some((value) => value > 0 && value < size),
        `${done}`,
      );
      // Progress is a summary: far fewer events than pivots.
      assert.ok(events.length < size, `${events.length}`);
    }
  }
});

test('a cancellation stops the oracle before it publishes any further progress', () => {
  assert.throws(
    () => solveTransportOracle(system([0.5], ones(1), ones(1)), { cancelled: () => true }),
    (error: any) => error.code === 'CANCELLED',
  );
  let requested = false;
  const events: unknown[] = [];
  assert.throws(
    () =>
      solveTransportOracle(system(Array(1600).fill(0.01), ones(40), ones(40)), {
        cancelled: () => requested,
        onProgress: (event) => {
          events.push(event);
          requested = true;
        },
      }),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.equal(events.length, 1);
});
