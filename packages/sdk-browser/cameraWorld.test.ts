// `cameraWorld.ts` pris fonction par fonction, confronté à Three au bit près (`Object.is`), sous un
// rig hostile : trois niveaux d'ancêtres, cisaillement au premier, échelle négative ET non uniforme
// au second — rien qu'une décomposition TRS ne rend. `readCameraWorld` doit produire les mêmes
// nombres que `projectionMatrix.clone().multiply(matrixWorldInverse)` et `Frustum` de Three, dans
// les deux conventions de profondeur, avec ou sans matrice monde singulière, NaN ou infinie.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';
import {
  createEngineCamera,
  holdCameraWorld,
  readCameraWorld,
  resolveCameraWorld,
  type HostCamera,
} from './cameraWorld.ts';

/** Trois niveaux : cisaillement figé au sommet, échelle négative et non uniforme au milieu. */
function hostileRig(fov = 50, aspect = 16 / 9) {
  const grandparent = new THREE.Object3D();
  grandparent.matrixAutoUpdate = false;
  // Rangées non orthogonales : y dépend de x, z dépend de y. Déterminant 1, toujours inversible.
  grandparent.matrix.set(1, 0, 0, 2, 0.4, 1, 0, -3, 0, 0.25, 1, 6, 0, 0, 0, 1);
  const parent = new THREE.Object3D();
  parent.position.set(-4, 1.5, 2);
  parent.quaternion.setFromEuler(new THREE.Euler(0.4, -0.7, 0.2));
  parent.scale.set(-2, 3, 0.5); // signe opposé sur x, trois grandeurs distinctes.
  grandparent.add(parent);
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 500);
  camera.position.set(0.3, -0.2, 1.1);
  camera.rotation.set(0.05, -0.1, 0.02);
  parent.add(camera);
  return camera;
}

/** La référence Three : ancêtres résolus, puis une caméra à plat qui porte la même `matrixWorld` au
 *  bit près — `updateMatrixWorld` y met alors à jour `matrixWorldInverse` comme le ferait l'hôte. */
function threeReference(camera: HostCamera) {
  resolveCameraWorld(camera);
  const flat = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  flat.coordinateSystem = camera.coordinateSystem;
  flat.matrixAutoUpdate = false;
  flat.matrix.copy(camera.matrixWorld);
  flat.matrixWorld.copy(flat.matrix);
  flat.projectionMatrix.copy(camera.projectionMatrix);
  flat.updateMatrixWorld(true);
  const viewProjection = flat.projectionMatrix.clone().multiply(flat.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    viewProjection,
    camera.coordinateSystem,
  );
  const planes = new Float64Array(24);
  frustum.planes.forEach((p, i) =>
    planes.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4),
  );
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  return { view: flat.matrixWorldInverse, viewProjection, planes, eye };
}

for (const webgpu of [false, true]) {
  test(`readCameraWorld sous un rig hostile (cisaillement, échelle négative non uniforme), convention ${webgpu ? 'WebGPU' : 'WebGL'}`, () => {
    const camera = hostileRig();
    if (webgpu) camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    const ref = threeReference(camera);
    const into = readCameraWorld(createEngineCamera(), camera);
    assertBits(into.world, camera.matrixWorld.elements);
    assertBits(into.projection, camera.projectionMatrix.elements);
    assertBits(into.view, ref.view.elements);
    assertBits(into.viewProjection, ref.viewProjection.elements);
    assertBits(into.planes, ref.planes);
    assertBits(into.eye, ref.eye.toArray());
    assert.equal(into.depthZeroToOne, webgpu);
  });
}

test('readCameraWorld : idempotente, et la seconde lecture n’alloue aucun nouveau tampon', () => {
  const camera = hostileRig();
  const into = createEngineCamera();
  readCameraWorld(into, camera);
  const [world, view, viewProjection, planes, eye] = [
    into.world,
    into.view,
    into.viewProjection,
    into.planes,
    into.eye,
  ];
  const premiere = [
    ...into.world,
    ...into.view,
    ...into.viewProjection,
    ...into.planes,
    ...into.eye,
  ];
  readCameraWorld(into, camera); // rien n'a bougé : même caméra, même rig.
  assert.equal(into.world, world, 'même tampon `world`');
  assert.equal(into.view, view, 'même tampon `view`');
  assert.equal(into.viewProjection, viewProjection, 'même tampon `viewProjection`');
  assert.equal(into.planes, planes, 'même tampon `planes`');
  assert.equal(into.eye, eye, 'même tampon `eye`');
  const seconde = [
    ...into.world,
    ...into.view,
    ...into.viewProjection,
    ...into.planes,
    ...into.eye,
  ];
  assert.deepEqual(seconde, premiere, 'et les mêmes bits, au flottant près');
});

test('readCameraWorld : matrice monde singulière, la vue tombe à zéro comme la référence', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.matrixAutoUpdate = false;
  camera.matrix.set(1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1); // troisième colonne nulle.
  const ref = threeReference(camera);
  const into = readCameraWorld(createEngineCamera(), camera);
  assertBits(into.view, ref.view.elements);
  assert.deepEqual([...into.view], new Array(16).fill(0), 'matrice nulle, comme Three');
  assertBits(into.viewProjection, ref.viewProjection.elements);
});

test('readCameraWorld : NaN, ±0 et infinis se propagent comme chez Three, sans lever', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.matrixAutoUpdate = false;
  camera.matrix.set(Infinity, 0, 0, -0, 0, NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const ref = threeReference(camera);
  const into = readCameraWorld(createEngineCamera(), camera);
  assertBits(into.world, camera.matrixWorld.elements);
  assertBits(into.view, ref.view.elements);
  assertBits(into.viewProjection, ref.viewProjection.elements);
  assert.ok(
    Number.isNaN(into.viewProjection[5]) || Number.isNaN(into.view[5]),
    'le NaN atteint bien la vue',
  );
});

test('holdCameraWorld : copie au bit près, indépendante de la source modifiée ensuite', () => {
  const camera = hostileRig();
  const source = readCameraWorld(createEngineCamera(), camera);
  const gelee = holdCameraWorld(createEngineCamera(), source);
  for (const champ of ['world', 'projection', 'view', 'viewProjection', 'planes', 'eye'] as const)
    assertBits(gelee[champ], source[champ]);
  assert.deepEqual(
    [gelee.near, gelee.far, gelee.fov, gelee.aspect, gelee.depthZeroToOne],
    [source.near, source.far, source.fov, source.aspect, source.depthZeroToOne],
  );
  // La source est réécrite par une image suivante : la copie gelée ne doit pas bouger.
  const avant = [...gelee.world];
  camera.position.set(99, -50, 12);
  readCameraWorld(source, camera);
  assert.notDeepEqual([...source.world], avant, 'témoin : la source, elle, a bien changé');
  assert.deepEqual([...gelee.world], avant, 'la copie gelée reste celle d’avant la nouvelle image');
});
