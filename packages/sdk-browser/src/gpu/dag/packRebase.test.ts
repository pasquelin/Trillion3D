// A camera that moved over worlds that did not rewrites only the translations of the rebased
// buffer. Oracle: the full rebase, `rootWorldsToRenderOrigin`, at the new origin — the buffer
// must end bit for bit as it would leave it, on random worlds and on the edge values.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rootTranslationsToRenderOrigin,
  rootWorldsMoved,
  rootWorldsToRenderOrigin,
} from './pack.ts';
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
    full = new Float32Array(moved.length),
    translations = new Float64Array(roots.length * 3);
  rootWorldsToRenderOrigin(moved, roots, from, translations);
  for (const origin of to) {
    rootTranslationsToRenderOrigin(moved, translations, origin);
    rootWorldsToRenderOrigin(full, roots, origin, new Float64Array(roots.length * 3));
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
  rootTranslationsToRenderOrigin(buffer, new Float64Array(0), [1, 2, 3]);
  assert.deepEqual([...buffer], [...Float32Array.from({ length: 16 }, (_, i) => i)]);
});

// A host write while the eye moves (#831): whether a pose moved is read against the rebase in hand,
// at its own origin. Oracle: the rebase itself — a pose left alone compares unmoved after a full
// rebase and after any number of translation-only ones, one changed beyond float32 compares moved.
test('a pose left alone reads unmoved at the origin of the rebase in hand, a moved one moved', () => {
  const next = random(1831);
  let visible = 0;
  for (let round = 0; round < 200; round++) {
    const roots = rootsOf(randomWorlds(next, 1 + Math.floor(next() * 40)));
    const buffer = new Float32Array(roots.length * 16),
      translations = new Float64Array(roots.length * 3);
    let origin = randomOrigin(next);
    rootWorldsToRenderOrigin(buffer, roots, origin, translations);
    for (let step = 0; step < 3; step++) {
      assert.equal(rootWorldsMoved(buffer, roots, origin), false, `round ${round}`);
      origin = randomOrigin(next);
      rootTranslationsToRenderOrigin(buffer, translations, origin);
    }
    assert.equal(rootWorldsMoved(buffer, roots, origin), false);
    const world = roots[Math.floor(next() * roots.length)].world.elements as Float64Array,
      at = Math.floor(next() * 16);
    world[at] = world[at] * 2 + 1;
    // Moved as the GPU sees it: the fresh rebase differs from the one in hand.
    const fresh = new Float32Array(buffer.length);
    rootWorldsToRenderOrigin(fresh, roots, origin, new Float64Array(roots.length * 3));
    const seen = fresh.some((value, i) => value !== buffer[i]);
    assert.equal(rootWorldsMoved(buffer, roots, origin), seen, `element ${at}`);
    if (seen) visible++;
  }
  assert.ok(visible > 100, 'most changes reach float32');
});

test('a NaN pose never reads unmoved; no root never moved', () => {
  const roots = rootsOf([Float64Array.from({ length: 16 }, (_, i) => (i === 13 ? NaN : i))]);
  const buffer = new Float32Array(16);
  rootWorldsToRenderOrigin(buffer, roots, [1, 2, 3], new Float64Array(3));
  assert.equal(rootWorldsMoved(buffer, roots, [1, 2, 3]), true);
  assert.equal(rootWorldsMoved(buffer, [], [1, 2, 3]), false);
});
