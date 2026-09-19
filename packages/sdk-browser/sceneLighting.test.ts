import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installSceneLighting } from './sceneLighting.ts';

test('Three reference adapter copies the authored directional target in world space', () => {
  const source = new THREE.Group(),
    parent = new THREE.Group();
  parent.position.set(4, 0, 0);
  source.add(parent);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(1, 3, 2);
  parent.add(sun);
  sun.target.position.set(4, 0, 0);
  source.add(sun.target);
  const reference = new THREE.Scene();
  installSceneLighting(reference, source, 0);
  const copy = reference.children.find(
    (object) => object instanceof THREE.DirectionalLight,
  ) as THREE.DirectionalLight;
  assert.deepEqual(copy.position.toArray(), [5, 3, 2]);
  assert.deepEqual(copy.target.position.toArray(), [4, 0, 0]);
});

test('a source without a declared light installs no light at all', () => {
  const scene = new THREE.Scene();
  installSceneLighting(scene, new THREE.Group(), 0);
  assert.equal(
    scene.children.filter((object) => (object as THREE.Light).isLight).length,
    0,
    'no light without a declared source: neither a hemisphere nor a replacement sun',
  );
});
