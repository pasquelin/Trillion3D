// `clusterErrorAtDistance` : la formule de `clusterErrorPixels` dont la distance du centre est déjà
// prise. Un appelant qui pose deux bornes sur la même sphère ne paie qu'une racine carrée ; la
// soustraction, la garde de plan proche et la division doivent rester les mêmes, aux mêmes bits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterErrorAtDistance, clusterErrorPixels } from './index.ts';

test('clusterErrorAtDistance is clusterErrorPixels with the square root already taken', () => {
  const centres: Array<[number, number, number]> = [
    [0, 0, 10],
    [-30, 4, 120],
    [0.001, 0, 0.2],
    [0, 0, 0],
  ];
  for (const [x, y, z] of centres)
    for (const error of [0, 1e-6, 0.5, 9, Infinity])
      for (const radius of [0, 1, 40]) {
        const distance = Math.sqrt(x * x + y * y + z * z);
        assert.ok(
          Object.is(
            clusterErrorAtDistance(error, 1.25, distance, radius, 640, 0.25),
            clusterErrorPixels(error, 1.25, x, y, z, radius, 640, 0.25),
          ),
          `error ${error}, radius ${radius}, centre ${x},${y},${z}`,
        );
      }
});

test('clusterErrorAtDistance rejects the same malformed parameters as clusterErrorPixels', () => {
  assert.throws(() => clusterErrorAtDistance(1, 1, NaN, 1, 600, 0.1), /Parametres de cluster/);
  assert.throws(() => clusterErrorAtDistance(-1, 1, 10, 1, 600, 0.1), /Parametres de cluster/);
  assert.throws(() => clusterErrorAtDistance(1, 1, 10, -1, 600, 0.1), /Parametres de cluster/);
  assert.throws(() => clusterErrorPixels(1, 1, NaN, 0, 0, 1, 600, 0.1), /Parametres de cluster/);
});
