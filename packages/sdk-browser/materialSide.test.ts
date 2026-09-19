import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sideOf } from './materialSide.ts';

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
