import assert from 'node:assert/strict';
import test from 'node:test';
import { seeded, sineHash } from './random.ts';

// The first values each generator gave before it moved into this module, read on the code the
// scenes were laid out with: a change here moves pebbles or the temple's stones.
const five = (next: () => number) => Array.from({ length: 5 }, next);
const indices = [0, 1, 2, 3, 4];

test('the examples keep their sequence', () => {
  assert.deepEqual(
    five(seeded(7)),
    [
      0.23878083983436227, 0.9134932646993548, 0.6124916663393378, 0.9269814591389149,
      0.049341175239533186,
    ],
  );
});

test('the temple keeps its scatter', () => {
  assert.deepEqual(
    indices.map((i) => sineHash(i, 3)),
    [
      0.26943514754384523, 0.4199000090593472, 0.2964715612447435, 0.9032924804014328,
      0.6177574384273612,
    ],
  );
});
