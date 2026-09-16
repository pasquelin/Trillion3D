// Ce que le partage de projection de `cutSelects` doit préserver : un remplaçant sans sphère à lui
// reprend celle du cluster, et la coupe ne projette plus cette sphère qu'une fois. Le verdict doit
// rester celui que rendait la double projection — la même sphère écrite deux fois —, et les gardes
// que `projectedClusterError` ne pose plus lui-même doivent rester posées par `projectedErrorAt` et
// par `clusterErrorAtDepth`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clusterErrorPixels } from '../sdk-core/index.ts';
import { cutSelects, projectedClusterError } from './pageSelectionMath.ts';

const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
cam.position.set(0.4, 1.1, 7);
cam.lookAt(0.2, 0, 0);
cam.updateMatrixWorld();
const E = cam.matrixWorldInverse.elements;
const STRETCH = 1.7,
  FOCAL = 940,
  NEAR = cam.near;

test('un remplaçant sans sphère à lui rend le verdict de la sphère propre écrite deux fois', () => {
  for (const sphere of [
    [0, 0, 0, 1],
    [3.5, -2, -14, 0.25],
    [-0.1, 0.2, 6.9, 4],
    [0, 0, 1e6, 1e-3],
  ])
    for (const own of [0, 1e-6, 0.02, 3, Infinity])
      for (const parent of [0, 1e-6, 0.05, 9, Infinity, null, undefined])
        for (const seuil of [0, 1e-9, 0.5, 4, 1e6]) {
          const partage = { lodError: own, sphere, parentError: parent };
          // La même donnée, mais avec une sphère de remplaçant explicite et distincte en mémoire :
          // c'est le chemin qui projette deux fois, celui d'avant le lot.
          const explicite = { ...partage, parentSphere: [...sphere] };
          assert.equal(
            cutSelects(partage, E, STRETCH, FOCAL, NEAR, seuil),
            cutSelects(explicite, E, STRETCH, FOCAL, NEAR, seuil),
            `own=${own} parent=${parent} seuil=${seuil} sphere=${sphere}`,
          );
        }
});

test('sans sphère, seule une erreur nulle reste nulle : tout le reste est l’infini', () => {
  for (const sphere of [null, undefined]) {
    assert.equal(projectedClusterError(0, sphere, 0, E, STRETCH, FOCAL, NEAR), 0);
    for (const err of [1e-9, 2, Infinity, null, undefined, -1, NaN])
      assert.equal(projectedClusterError(err, sphere, 0, E, STRETCH, FOCAL, NEAR), Infinity);
  }
});

test('une erreur mal formée avec sphère est toujours refusée, par la garde restée en aval', () => {
  const sphere = [1, 2, -9, 0.5];
  for (const err of [-1, NaN])
    assert.throws(
      () => projectedClusterError(err, sphere, 0, E, STRETCH, FOCAL, NEAR),
      /Parametres de cluster invalides/,
    );
});

test('un centre non fini est toujours refusé, sans garde propre à clusterErrorPixels', () => {
  for (const [x, y] of [
    [NaN, 0],
    [0, NaN],
    [Infinity, 0],
    [0, -Infinity],
    [1e200, 1e200],
  ])
    assert.throws(
      () => clusterErrorPixels(0.5, 1, x, y, -10, 0.25, 900, 0.1),
      /Parametres de cluster invalides/,
      `centre (${x}, ${y})`,
    );
  // Les deux court-circuits restent devant la garde : ils ne lisent pas le centre.
  assert.equal(clusterErrorPixels(0, 1, NaN, NaN, -10, 0.25, 900, 0.1), 0);
  assert.equal(clusterErrorPixels(Infinity, 1, NaN, NaN, -10, 0.25, 900, 0.1), Infinity);
});
