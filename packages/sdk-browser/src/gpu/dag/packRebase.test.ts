// A camera that moved over worlds that did not rewrites only the translations of the rebased
// buffer. Oracle: the full rebase, `rootWorldsToRenderOrigin`, at the new origin — the buffer
// must end bit for bit as it would leave it, on random worlds and on the edge values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rootTranslationsToRenderOrigin, rootWorldsToRenderOrigin } from './pack.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import type { DagRoot } from './types.ts';

const EDGES = [NaN, 0, -0, Infinity, -Infinity, 1e39, -1e39, 1e-45, 5e-324, 2 ** 24 + 1, 1e300];

const rootsOf = (worlds: Float64Array[]) =>
  worlds.map((elements) => ({ world: { elements } }) as unknown as DagRoot);

/** Worlds in double, of magnitudes from the millimetre to far beyond single precision. */
function randomWorlds(next: () => number, count: number) {
  return Array.from({ length: count }, () =>
    Float64Array.from({ length: 16 }, () => (next() - 0.5) * 10 ** Math.floor(next() * 12 - 3)),
  );
}

const randomOrigin = (next: () => number) =>
  [0, 1, 2].map(() => (next() - 0.5) * 10 ** Math.floor(next() * 10));

/** Full rebase at `from`, then translations only at each of `to`: bits of a full rebase there. */
function assertSameAsFull(roots: readonly DagRoot[], from: ArrayLike<number>, to: number[][]) {
  const moved = new Float32Array(Math.max(1, roots.length) * 16),
    full = new Float32Array(moved.length);
  rootWorldsToRenderOrigin(moved, roots, from);
  for (const origin of to) {
    rootTranslationsToRenderOrigin(moved, roots, origin);
    rootWorldsToRenderOrigin(full, roots, origin);
    assert.deepEqual(
      new Uint32Array(moved.buffer),
      new Uint32Array(full.buffer),
      `origin ${origin.join(', ')}`,
    );
  }
}

test('translations alone leave the bits of a full rebase, on random worlds and eyes', () => {
  const next = random(918);
  for (let round = 0; round < 200; round++) {
    const roots = rootsOf(randomWorlds(next, 1 + Math.floor(next() * 40)));
    const path = Array.from({ length: 5 }, () => randomOrigin(next));
    assertSameAsFull(roots, randomOrigin(next), path);
  }
});

test('translations alone leave the bits of a full rebase on NaN, ±0, ±Inf and extremes', () => {
  const next = random(7);
  const worlds = EDGES.flatMap((edge) =>
    [0, 5, 12, 13, 14, 15].map((at) => {
      const world = randomWorlds(next, 1)[0];
      world[at] = edge;
      return world;
    }),
  );
  const roots = rootsOf(worlds);
  const origins = EDGES.flatMap((edge) => [
    [edge, 0, 0],
    [1, edge, -1],
    [edge, edge, edge],
  ]);
  assertSameAsFull(roots, [0, 0, 0], origins);
  assertSameAsFull(roots, [NaN, NaN, NaN], origins);
});

test('no root: nothing is written', () => {
  const buffer = Float32Array.from({ length: 16 }, (_, i) => i);
  rootTranslationsToRenderOrigin(buffer, [], [1, 2, 3]);
  assert.deepEqual([...buffer], [...Float32Array.from({ length: 16 }, (_, i) => i)]);
});
