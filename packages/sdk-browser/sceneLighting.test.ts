import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installSceneLighting } from './sceneLighting.ts';
import { lighting } from './backendCommon.ts';

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
  installSceneLighting(reference, source);
  const copy = reference.children.find(
    (object) => object instanceof THREE.DirectionalLight,
  ) as THREE.DirectionalLight;
  assert.deepEqual(copy.position.toArray(), [5, 3, 2]);
  assert.deepEqual(copy.target.position.toArray(), [4, 0, 0]);
});

test('a source without a declared light installs no light at all', () => {
  const scene = new THREE.Scene();
  installSceneLighting(scene, new THREE.Group());
  assert.equal(
    scene.children.filter((object) => (object as THREE.Light).isLight).length,
    0,
    'no light without a declared source: neither a hemisphere nor a replacement sun',
  );
});

test('placing the lights leaves the display background to the boundary that owns the graph', () => {
  const scene = new THREE.Scene();
  installSceneLighting(scene, new THREE.Group());
  assert.equal(scene.background, null, 'the light placement declares no clear colour');
  lighting(scene, 0x112233, new THREE.Group());
  assert.deepEqual(
    (scene.background as THREE.Color).getHex(),
    0x112233,
    'the witness boundary sets it with the scene it publishes',
  );
});

test('a light that aims carries its own target: the source graph keeps the one it declared', () => {
  const source = new THREE.Group();
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  source.add(sun);
  source.add(sun.target);
  const scene = new THREE.Scene();
  installSceneLighting(scene, source);
  const copy = scene.children.find(
    (object) => object instanceof THREE.DirectionalLight,
  ) as THREE.DirectionalLight;
  assert.notEqual(copy.target, sun.target, 'the copy does not share the source aim');
  assert.equal(sun.target.parent, source, 'the source keeps its own target');
  assert.equal(copy.target.parent, scene, 'the copied aim is placed in the display graph');
});
