import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { orderPendingUrls, pixelScaleOf, type PriorityRecord } from './streamingPriority.ts';

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
  return orderPendingUrls(records, cam, pixelScaleOf(cam, [1280, 720], [1, 1]), []);
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
