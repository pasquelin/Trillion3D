import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installSceneLighting } from './sceneLighting.ts';
import { hostAimNode, lighting } from '../host/three/displayObjects.ts';

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
  installSceneLighting(reference, source, hostAimNode);
  const copy = reference.children.find(
    (object) => object instanceof THREE.DirectionalLight,
  ) as THREE.DirectionalLight;
  assert.deepEqual(copy.position.toArray(), [5, 3, 2]);
  assert.deepEqual(copy.target.position.toArray(), [4, 0, 0]);
});

test('a source without a declared light installs no light at all', () => {
  const scene = new THREE.Scene();
  installSceneLighting(scene, new THREE.Group(), hostAimNode);
  assert.equal(
    scene.children.filter((object) => (object as THREE.Light).isLight).length,
    0,
    'no light without a declared source: neither a hemisphere nor a replacement sun',
  );
});

test('placing the lights leaves the display background to the boundary that owns the graph', () => {
  const scene = new THREE.Scene();
  installSceneLighting(scene, new THREE.Group(), hostAimNode);
  assert.equal(scene.background, null, 'the light placement declares no clear colour');
  lighting(scene, 0x112233, new THREE.Group());
  const background: THREE.Color | null = scene.background as THREE.Color | null;
  assert.equal(
    background?.getHex(),
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
  installSceneLighting(scene, source, hostAimNode);
  const copy = scene.children.find(
    (object) => object instanceof THREE.DirectionalLight,
  ) as THREE.DirectionalLight;
  assert.notEqual(copy.target, sun.target, 'the copy does not share the source aim');
  assert.equal(sun.target.parent, source, 'the source keeps its own target');
  assert.equal(copy.target.parent, scene, 'the copied aim is placed in the display graph');
});

/** A host of the contract's shape alone: no rendering library on either side. */
function fakeLight(extra: Record<string, unknown>, clone: () => unknown) {
  return {
    name: 'light',
    visible: true,
    isLight: true,
    color: { r: 1, g: 1, b: 1 },
    intensity: 1,
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1] },
    parent: null,
    updateWorldMatrix() {},
    clone,
    ...extra,
  };
}
function fakeGraph(light: unknown) {
  const added: unknown[] = [];
  return {
    added,
    source: {
      name: 'source',
      visible: true,
      traverse: (visit: (n: never) => void) => visit(light as never),
    },
    scene: { add: (node: unknown) => added.push(node), remove: () => {} },
  };
}
const fakeAim = () => ({
  visible: true,
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
  matrixWorld: { elements: new Array(16).fill(0) },
  parent: null,
  updateWorldMatrix() {},
});

test('the aim is read on the light the source declared, not on the copy the host returned', () => {
  const target = {
    ...fakeAim(),
    matrixWorld: { elements: [...new Array(12).fill(0), 7, 8, 9, 1] },
  };
  // A host whose `clone()` drops the target: the old read of the copy lost the aim silently.
  const light = fakeLight({ target }, () => fakeLight({}, () => null));
  const graph = fakeGraph(light);
  installSceneLighting(graph.scene as never, graph.source as never, fakeAim as never);
  assert.equal(graph.added.length, 2, 'the aim node is placed beside the copy');
  const aim = graph.added[0] as ReturnType<typeof fakeAim>;
  assert.deepEqual(
    [aim.position.x, aim.position.y, aim.position.z],
    [7, 8, 9],
    'and it is posed on the world position of the target the source declared',
  );
});

test('a hemisphere the host declared without a ground colour is placed, not crashed', () => {
  const light = fakeLight({ isHemisphereLight: true }, () =>
    fakeLight({ isHemisphereLight: true }, () => null),
  );
  const graph = fakeGraph(light);
  const installed = installSceneLighting(
    graph.scene as never,
    graph.source as never,
    fakeAim as never,
  );
  assert.equal(installed.lit, true);
  assert.equal(graph.added.length, 1, 'a hemisphere aims at nothing: no aim node');
});
