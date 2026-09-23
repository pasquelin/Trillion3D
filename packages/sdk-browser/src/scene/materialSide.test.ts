import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hostSide, sideOf } from './materialSide.ts';

test('sideOf: each host side constant maps to its engine name, the first of an array decides', () => {
  const front = new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    back = new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
    double = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  assert.equal(sideOf(front), 'front');
  assert.equal(sideOf(back), 'back');
  assert.equal(sideOf(double), 'double');
  assert.equal(sideOf([back, double]), 'back');
  assert.equal(sideOf(new THREE.MeshBasicMaterial()), 'front', 'the host default is front');
  assert.equal(sideOf([]), 'front', 'an empty array declares nothing: front, not a crash');
});

test('hostSide: each engine name maps back to the host constant the library draws with', () => {
  assert.equal(hostSide('front'), THREE.FrontSide);
  assert.equal(hostSide('back'), THREE.BackSide);
  assert.equal(hostSide('double'), THREE.DoubleSide);
  for (const side of ['front', 'back', 'double'] as const)
    assert.equal(
      sideOf(new THREE.MeshBasicMaterial({ side: hostSide(side) as THREE.Side })),
      side,
      side,
    );
});
