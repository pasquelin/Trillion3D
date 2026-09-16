import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { orderPendingUrls, pixelScaleOf, type PriorityRecord } from './streamingPriority.ts';
import { referenceOrder } from './bench/oracles/socle-math-priorite.mjs';
import { cameraMoteur } from './cameraFixture.ts';

function camera() {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
const identity = new THREE.Matrix4();
function record(
  url: string,
  centre: [number, number, number],
  radius: number,
  parentError: number,
  streamUrl?: string,
): PriorityRecord {
  return {
    url,
    streamUrl,
    min: [centre[0] - radius, centre[1] - radius, centre[2] - radius],
    max: [centre[0] + radius, centre[1] + radius, centre[2] + radius],
    matrix: identity,
    lodError: 0,
    sphere: [...centre, radius],
    parentError,
    parentSphere: [...centre, radius],
  };
}
function order(records: PriorityRecord[]) {
  const cam = camera();
  return orderPendingUrls(
    records,
    cameraMoteur(cam),
    pixelScaleOf(cameraMoteur(cam).projection, [1280, 720], [1, 1]),
    [],
  );
}

test('at equal error the nearer bundle is asked for first', () => {
  const near = record('near', [0, 0, 0], 1, 0.5),
    far = record('far', [0, 0, -60], 1, 0.5);
  assert.deepEqual(order([far, near]), ['near', 'far']);
  assert.deepEqual(order([near, far]), ['near', 'far']);
});

test('at equal distance the bundle whose absence shows the most pixels is asked for first', () => {
  const loud = record('loud', [0, 0, 0], 1, 4),
    quiet = record('quiet', [0, 0, 0], 1, 0.01);
  assert.deepEqual(order([quiet, loud]), ['loud', 'quiet']);
});

test('a bundle inherits the worst error of the clusters it carries, since one request serves them all', () => {
  // Two bundles of two clusters each. The second bundle holds one cluster nobody would rush for and
  // one that matters: the request that makes both drawable must not be ordered on the quiet one.
  const records = [
    record('a0', [0, 0, 0], 1, 1, 'bundle-a'),
    record('a1', [0, 0, 0], 1, 1, 'bundle-a'),
    record('b0', [0, 0, 0], 1, 0.001, 'bundle-b'),
    record('b1', [0, 0, 0], 1, 8, 'bundle-b'),
  ];
  assert.deepEqual(order(records), ['bundle-b', 'bundle-a']);
});

test('a cluster already resident is not asked for again', () => {
  const held = record('held', [0, 0, 0], 1, 4);
  held.array = new Uint32Array(3);
  assert.deepEqual(order([held, record('missing', [0, 0, -60], 1, 0.5)]), ['missing']);
  assert.deepEqual(order([held]), []);
});

test('a cache with no cluster error falls back on the screen footprint of the bounds', () => {
  const big: PriorityRecord = { url: 'big', min: [-4, -4, -1], max: [4, 4, 1], matrix: identity };
  const small: PriorityRecord = {
    url: 'small',
    min: [-0.1, -0.1, -1],
    max: [0.1, 0.1, 1],
    matrix: identity,
  };
  assert.deepEqual(order([small, big]), ['big', 'small']);
});

// `orderPendingUrls` composait sa vue par un produit 4×4 écrit en ligne (accumulateur à `0`) ; il
// utilise maintenant `multiplyMatrix4`, qui n'a aucune somme initiale et peut donc rendre -0 là où
// l'ancien rendait toujours +0 (voir `packages/sdk-core/mathMatrix4.test.ts`). Ce test vérifie que
// l'ordre public rendu par la file reste identique à celui du code d'avant sur des matrices hostiles
// aux zéros signés ; l'oracle est `referenceOrder`, la copie du code d'avant du rattachement.
test('orderPendingUrls : matrices hostiles aux zéros signés (axes alignés, ±0) — même ordre que le code d’avant', () => {
  const pixelScale = [500, 500];
  const record2 = (url: string, matrice: number[], sphere?: number[]): PriorityRecord => ({
    url,
    matrix: new THREE.Matrix4().fromArray(matrice),
    min: [-1, -1, -1],
    max: [1, 1, 1],
    lodError: 2,
    sphere,
  });
  const cas: PriorityRecord[][] = [
    [
      record2('a', [1, -0, 0, 0, 0, 1, -0, 0, -0, 0, 1, 0, 0, 0, -5, 1], [0, 0, 0, 1]),
      record2('b', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0, -0, -0, 1], [-0, 0, -0, 1]),
    ],
    [
      record2('c', [-1, -0, 0, 0, 0, 1, 0, 0, 0, -0, -1, 0, 0, 0, -8, 1]),
      record2('d', [1, 0, -0, 0, -0, 1, 0, 0, 0, 0, 1, 0, 2, -0, -3, 1]),
    ],
  ];
  for (const records of cas) {
    const cam = camera();
    const recu = orderPendingUrls(records, cameraMoteur(cam), pixelScale, []);
    const attendu = referenceOrder(records, cam, pixelScale);
    assert.deepEqual(recu, attendu, `records ${records.map((r) => r.url)}`);
  }
});
