import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';
import { ones, system } from './oracle.fixture.ts';
import {
  LIGHTING_TRANSPORT_FORMAT_VERSION,
  LIGHTING_TRANSPORT_LIMITS,
  type TransportSnapshot,
} from './contracts.ts';

const SINGULAR_PIVOT = LIGHTING_TRANSPORT_LIMITS.singularPivot;

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
