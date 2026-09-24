import assert from 'node:assert/strict';
import test from 'node:test';
import { hash, mulberry32, noise1, seeded, sineHash, valueNoise } from './random.ts';

// The first values each generator gave before it moved into this module, read on the code the
// scenes were laid out with: a change here moves pebbles, clouds, traffic or the temple's stones.
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

test('the open world keeps its sequence', () => {
  assert.deepEqual(
    five(mulberry32(332)),
    [
      0.7368519869633019, 0.427600473864004, 0.39559578825719655, 0.38008124101907015,
      0.29980341834016144,
    ],
  );
});

test('the sky keeps its hash and its noise', () => {
  assert.deepEqual(
    indices.map((i) => hash(9, i)),
    [
      0.43538738205097616, 0.666214189492166, 0.021088937763124704, 0.14823711104691029,
      0.5386811678763479,
    ],
  );
  assert.deepEqual(
    [0, 0.5, 1.25, 2.75, 4.1].map((x) => noise1(5, x)),
    [
      -0.2746611814945936, -0.49168447009287775, -0.7264938205626095, -0.3273838946042815,
      -0.3574482711963355,
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

// #402: the relief of three pages, gathered here, each on the lattice it was laid out with:
// `scattered-on-a-surface` keeps its values bit for bit, the planet its own to rounding.
test('the reliefs keep their noise', () => {
  const at = [
    [0.3, 1.7, -2.2, 1],
    [11.4, -0.6, 3.9, 2],
    [-5.25, 2.5, 0.75, 3],
  ];
  const scattered = valueNoise();
  assert.deepEqual(
    at.map(([x, y, z]) => scattered(x, y, z)),
    [-0.34218649521303457, 0.12095994121124098, -0.10903564714681124],
  );
  const planet = valueNoise(1274126177);
  const before = [0.19532346389272182, -0.24616740278646237, 0.050191393227578374];
  at.forEach(([x, y, z, seed], i) =>
    assert.ok(Math.abs(planet(x, y, z, seed) - before[i]) < 1e-15),
  );
});
