import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as G from '../../../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { installSceneLighting } from '../../../../../../packages/sdk-browser/src/lighting/sceneLighting.ts';
import { lighting } from '../../../displayObjects.ts';

test('reference adapter copies the authored directional target in world space', () => {
  const source = new G.Group(),
    parent = new G.Group();
  parent.position.set(4, 0, 0);
  source.add(parent);
  const sun = G.directionalLight(0xffffff, 2);
  sun.position.set(1, 3, 2);
  parent.add(sun);
  sun.target.position.set(4, 0, 0);
  source.add(sun.target);
  const reference = new THREE.Scene();
  lighting(reference, 0, source);
  const copy = reference.children.find(
    (object) => object instanceof THREE.DirectionalLight,
  ) as THREE.DirectionalLight;
  assert.deepEqual(copy.position.toArray(), [5, 3, 2]);
  assert.deepEqual(copy.target.position.toArray(), [4, 0, 0]);
});

test('a source without a declared light installs no light at all', () => {
  const scene = new THREE.Scene();
  installSceneLighting(scene, new G.Group());
  assert.equal(
    scene.children.filter((object) => (object as THREE.Light).isLight).length,
    0,
    'no light without a declared source: neither a hemisphere nor a replacement sun',
  );
});

test('placing the lights leaves the display background to the boundary that owns the graph', () => {
  const scene = new THREE.Scene();
  installSceneLighting(scene, new G.Group());
  assert.equal(scene.background, null, 'the light placement declares no clear colour');
  lighting(scene, 0x112233, new G.Group());
  const background: THREE.Color | null = scene.background as THREE.Color | null;
  assert.equal(
    background?.getHex(),
    0x112233,
    'the witness boundary sets it with the scene it publishes',
  );
});

test('a light that aims carries its own target: the source graph keeps the one it declared', () => {
  const source = new G.Group();
  const sun = G.directionalLight(0xffffff, 1);
  source.add(sun);
  source.add(sun.target);
  const scene = new THREE.Scene();
  lighting(scene, 0, source);
  const copy = scene.children.find(
    (object) => object instanceof THREE.DirectionalLight,
  ) as THREE.DirectionalLight;
  assert.notEqual(copy.target, sun.target, 'the copy does not share the source aim');
  assert.equal(sun.target.parent, source, 'the source keeps its own target');
  assert.equal(copy.target.parent, scene, 'the copied aim is placed in the display graph');
});

/** A display graph that records what the placement adds to it. */
function recordingScene() {
  const added: unknown[] = [];
  return { added, scene: { add: (node: unknown) => added.push(node), remove: () => {} } };
}

test('a copy aims at its own target, posed where the source declared its own', () => {
  const source = new G.Group();
  const sun = G.directionalLight(0xffffff, 1);
  sun.target.position.set(7, 8, 9);
  source.add(sun, sun.target);
  const { added, scene } = recordingScene();
  installSceneLighting(scene, source);
  const [aim, copy] = added as [G.Object3D, G.Light];
  assert.equal(aim, copy.target, 'the aim node placed beside the copy is its own target');
  assert.notEqual(aim, sun.target, 'the source keeps the target it declared');
  assert.deepEqual(aim.position.toArray(), [7, 8, 9]);
});

test('a point, an ambient and a probe are placed with no aim node', () => {
  const source = new G.Group();
  source.add(G.pointLight(0xffffff, 1), G.ambientLight(0xffffff, 1), G.lightProbe());
  const { added, scene } = recordingScene();
  const installed = installSceneLighting(scene, source);
  assert.equal(installed.lit, true);
  assert.equal(added.length, 3, 'each light aims at nothing: its copy alone');
});

// #558 (D): a casting lamp shown or hidden after the copy is heard at the placement that sees it,
// so WebGL2 never draws it unshadowed silently.
test('a source lamp shown, hidden or set to cast after the copy changes the casting list', () => {
  const sun = G.directionalLight();
  sun.name = 'sun';
  sun.castShadow = true;
  sun.visible = false;
  const source = new G.Group();
  source.add(sun, G.pointLight());
  const lighting = installSceneLighting({ add() {}, remove() {} }, source);
  let heard = 0;
  lighting.castingChanged = () => void heard++;
  assert.deepEqual(lighting.casting, []);
  sun.visible = true;
  lighting.update();
  assert.deepEqual([lighting.casting, heard], [['sun'], 1]);
  lighting.update();
  assert.equal(heard, 1, 'a placement that shows no lamp anew says nothing');
  sun.castShadow = false;
  lighting.update();
  assert.deepEqual([lighting.casting, heard], [[], 2], 'its cast cleared, it is no longer named');
  sun.castShadow = true;
  sun.visible = false;
  lighting.update();
  assert.equal(heard, 2, 'hidden, it asks for no shadow');
});
