/**
 * The engine's scene and camera are the core's `Scene` and `Camera`: a draw reads a core camera's
 * reference projection, the contract lights a core scene and lays its fog on it, a view hooks its
 * draw, and the engine numbers both in its one count, with no field a page's own does not carry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSceneLightStore } from '../../../../sdk-core/src/index.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { Scene } from '../../world/core/scene.ts';
import { sceneFogOf } from '../../world/core/sceneFog.ts';
import { createHostDrawCamera, readHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { attachContractLights } from '../../lighting/contractLights.ts';
import { installLighting } from '../../lighting/contractLightingApi.ts';
import { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import { isLightNode } from './kinds.ts';
import { numbered, serialOf } from './serial.ts';
import { GraphSurface } from './surface.ts';

/** The projection a draw uploads for `camera`, in the numbers it uploads. */
const drawnProjection = (camera: HostCamera) =>
  Array.from(readHostDrawCamera(createHostDrawCamera(), camera).projection);
const reference = (matrix: THREE.Matrix4) => Array.from(new Float32Array(matrix.elements));

test('a core camera is drawn from: a draw reads the reference projection, kept current', () => {
  const eye = new Camera('perspective', { fov: 47, aspect: 1.6, near: 0.3, far: 900, zoom: 1.5 });
  const witness = new THREE.PerspectiveCamera(47, 1.6, 0.3, 900);
  witness.zoom = 1.5;
  witness.updateProjectionMatrix();
  assert.deepEqual(drawnProjection(eye), reference(witness.projectionMatrix));
  eye.fov = 30;
  witness.fov = 30;
  witness.updateProjectionMatrix();
  assert.deepEqual(drawnProjection(eye), reference(witness.projectionMatrix), 'an optic write');
  const box = new Camera('orthographic', { left: -3, right: 5, top: 2, bottom: -1, far: 40 });
  const boxWitness = new THREE.OrthographicCamera(-3, 5, 2, -1, 0.1, 40);
  assert.deepEqual(drawnProjection(box), reference(boxWitness.projectionMatrix));
  eye.position.set(1, -2, 4);
  eye.lookAt(3, 0, -5);
  eye.updateMatrixWorld();
  witness.position.set(1, -2, 4);
  witness.lookAt(3, 0, -5);
  witness.updateMatrixWorld();
  assert.deepEqual([...eye.matrixWorldInverse.elements], witness.matrixWorldInverse.elements);
});

test('a draw reads the eye as the world translation, each coordinate rounded to float32', () => {
  const eye = new Camera('perspective', { fov: 47, aspect: 1.6, near: 0.3, far: 900 });
  eye.position.set(0.1, -1 / 3, 1e7 + 0.7);
  eye.updateMatrixWorld();
  const drawn = readHostDrawCamera(createHostDrawCamera(), eye);
  assert.deepEqual([...drawn.eye], [...new Float32Array([0.1, -1 / 3, 1e7 + 0.7])]);
});

test('a core scene is lit: the contract lights hang on it and its fog lands on it', () => {
  const [scene, store] = [new Scene(), createSceneLightStore()];
  const contract = attachContractLights(
    scene,
    store,
    installLighting(scene, 0, new Object3D()),
    () => {},
  );
  const fog = { color: [0.2, 0.3, 0.4] as [number, number, number], near: 1, far: 50 };
  store.setEnvironment({ exposure: 1, fog });
  store.add({
    id: 'lamp',
    kind: 'point',
    position: [1, 2, 3],
    range: 10,
    color: [1, 1, 1],
    intensity: 7,
    castsShadow: false,
  });
  contract.apply();
  assert.deepEqual(sceneFogOf(scene.fog), fog, 'the lights read the fog the contract holds');
  const kinds: string[] = [];
  scene.traverseVisible((node) => isLightNode(node) && kinds.push(node.kind));
  assert.deepEqual(kinds, ['point']);
  store.setEnvironment({ exposure: 1 });
  contract.apply();
  assert.equal(scene.fog, null, 'a fog taken away leaves the scene');
});

test('a core scene is hooked: a draw calls its hooks around the scene it draws', () => {
  const scene = new Scene();
  const geometry = new Geometry().setIndex(new BufferAttribute(new Uint32Array(3), 1));
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  scene.add(
    Object.assign(new Mesh(geometry, new GraphSurface('standard')), { frustumCulled: false }),
  );
  const heard: string[] = [];
  scene.onBeforeRender = () => heard.push('before');
  scene.onAfterRender = () => heard.push('after');
  const context = createTestContext({ answers: { getExtension: () => ({}) } }),
    draw = createSceneDraw(context.gl, scene);
  draw.render({} as HostCamera);
  draw.host.drawHostGeometry(createHostDrawCamera(), {
    toneMapped: false,
    framebuffer: null,
    width: 8,
    height: 4,
  });
  assert.deepEqual(heard, ['before', 'after']);
  assert.equal(
    context.of('drawElements').length,
    2,
    'source capture and final draw share one hook pair',
  );
  draw.dispose();
});

test('the engine numbers a core scene and camera in its one count; a page-built one takes none', () => {
  const scene = numbered(new Scene()),
    camera = numbered(new Camera('perspective')),
    mesh = numbered(new Mesh(new Geometry(), new GraphSurface('basic')));
  assert.equal(serialOf(camera), serialOf(scene)! + 1);
  assert.equal(serialOf(mesh), serialOf(camera)! + 1);
  assert.equal(serialOf(new Scene()), undefined);
  assert.equal(serialOf(new Camera('perspective')), undefined);
});

test('a core scene and camera hold no field the engine needs beyond a page one', async () => {
  const base = new Set(Object.keys(new Object3D()));
  const own = (node: object) => Object.keys(node).filter((key) => !base.has(key));
  assert.deepEqual(own(new Scene()), [
    '_background',
    'recoloured',
    'environment',
    '_fog',
    'refogged',
  ]);
  const camera = new Camera('perspective');
  assert.deepEqual(own(camera), ['isCamera', '_optics', '_fitAspect', 'projection']);
  void camera.projectionMatrix;
  assert.deepEqual(own(camera), [
    'isCamera',
    '_optics',
    '_fitAspect',
    'projection',
    '_projectionMatrix',
  ]);
  await assert.rejects(new Scene().load('model.json'), { code: 'UNSUPPORTED_SCENE_UPDATE' });
});
