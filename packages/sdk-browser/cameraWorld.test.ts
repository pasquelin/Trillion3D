// `cameraWorld.ts` pris fonction par fonction, confronté à Three au bit près (`Object.is`), sous un
// rig hostile : trois niveaux d'ancêtres, cisaillement au premier, échelle négative ET non uniforme
// au second — rien qu'une décomposition TRS ne rend. `readCameraWorld` doit produire les mêmes
// nombres que `projectionMatrix.clone().multiply(matrixWorldInverse)` et `Frustum` de Three, avec
// ou sans matrice monde singulière, NaN ou infinie.
//
// La PROJECTION, elle, n'est plus celle de l'hôte : le moteur la compose de l'optique déclarée, en
// profondeur inversée et plan lointain infini (`depthConvention.ts`). La référence Three reçoit
// donc cette projection-là, et ses six plans sont ceux du moteur avec les deux derniers échangés —
// en profondeur inversée, le plan qui borne le proche est celui que la profondeur directe appelait
// loin.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';
import { perspectiveProjection } from '../sdk-core/index.ts';
import {
  createEngineCamera,
  enginePose,
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
 *  bit près — `updateMatrixWorld` y met alors à jour `matrixWorldInverse` comme le ferait l'hôte —
 *  et la projection du MOTEUR. Ses deux derniers plans sont échangés : c'est le seul effet du
 *  renversement de la profondeur sur un tronc. */
function threeReference(camera: HostCamera) {
  resolveCameraWorld(camera);
  const { fov, aspect, near, zoom } = camera;
  const flat = new THREE.PerspectiveCamera(fov, aspect, near, camera.far);
  flat.matrixAutoUpdate = false;
  flat.matrix.copy(camera.matrixWorld);
  flat.matrixWorld.copy(flat.matrix);
  const projection = perspectiveProjection(new Float64Array(16), fov, aspect, near, zoom);
  flat.projectionMatrix.fromArray([...projection]);
  flat.updateMatrixWorld(true);
  const viewProjection = flat.projectionMatrix.clone().multiply(flat.matrixWorldInverse);
  const brut = new Float64Array(24);
  new THREE.Frustum()
    .setFromProjectionMatrix(viewProjection, THREE.WebGPUCoordinateSystem)
    .planes.forEach((p, i) => brut.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4));
  const planes = brut.slice();
  planes.set(brut.subarray(20, 24), 16);
  planes.set(brut.subarray(16, 20), 20);
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  return { view: flat.matrixWorldInverse, viewProjection, planes, projection, eye };
}

for (const webgpu of [false, true]) {
  test(`readCameraWorld sous un rig hostile (cisaillement, échelle négative non uniforme), convention ${webgpu ? 'WebGPU' : 'WebGL'}`, () => {
    const camera = hostileRig();
    if (webgpu) camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    const ref = threeReference(camera);
    const into = readCameraWorld(createEngineCamera(), camera);
    assertBits(into.world, camera.matrixWorld.elements);
    // La projection du moteur ne dépend plus de la convention de l'hôte : les mêmes seize nombres
    // pour les deux passages de la boucle.
    assertBits(into.projection, ref.projection);
    assertBits(into.view, ref.view.elements);
    assertBits(into.viewProjection, ref.viewProjection.elements);
    assertBits(into.planes, ref.planes);
    assertBits(into.eye, ref.eye.toArray());
  });
}

test('readCameraWorld : idempotente, et la seconde lecture n’alloue aucun nouveau tampon', () => {
  const camera = hostileRig();
  const into = createEngineCamera();
  readCameraWorld(into, camera);
  const { world, view, viewProjection, planes, eye } = into;
  const premiere = [...world, ...view, ...viewProjection, ...planes, ...eye];
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
    [gelee.near, gelee.far, gelee.fov, gelee.aspect],
    [source.near, source.far, source.fov, source.aspect],
  );
  // La source est réécrite par une image suivante : la copie gelée ne doit pas bouger.
  const avant = [...gelee.world];
  camera.position.set(99, -50, 12);
  readCameraWorld(source, camera);
  assert.notDeepEqual([...source.world], avant, 'témoin : la source, elle, a bien changé');
  assert.deepEqual([...gelee.world], avant, 'la copie gelée reste celle d’avant la nouvelle image');
});

test('enginePose : la position égale getWorldPosition, sous le même rig hostile (profondeur 3, cisaillement, échelle négative non uniforme)', () => {
  const camera = hostileRig();
  const attendu = resolveCameraWorld(camera).getWorldPosition(new THREE.Vector3());
  const obtenu = enginePose(readCameraWorld(createEngineCamera(), camera));
  assertBits(obtenu.position, attendu.toArray());
});

test('enginePose : le quaternion égale getWorldQuaternion, sous le même rig hostile (à l’arrondi de la normalisation près)', () => {
  const camera = hostileRig();
  const attendu = resolveCameraWorld(camera).getWorldQuaternion(new THREE.Quaternion());
  const obtenu = enginePose(readCameraWorld(createEngineCamera(), camera));
  const proche = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  assert.ok(
    ['x', 'y', 'z', 'w'].every((k, i) =>
      proche(obtenu.quaternion[i], (attendu as unknown as Record<string, number>)[k]),
    ),
    `quaternion ${obtenu.quaternion} !== ${attendu.toArray()}`,
  );
  // Témoin : sous ce rig, la pose locale de la caméra n'est ni la position ni l'orientation publiées.
  assert.notDeepEqual(obtenu.position, camera.position.toArray());
});

test('enginePose : rejoue la même caméra hôte, jumelle sans parent — même position, même quaternion que Three', () => {
  // Une caméra plate, sans ancêtre, discrimine : si `enginePose` lisait la pose LOCALE au lieu de la
  // translation de `world`, elle continuerait de coïncider avec Three ici, masquant le défaut que le
  // test précédent, lui, débusque sous un rig.
  const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.5, 200);
  camera.position.set(-8, 4.5, 13.25);
  camera.rotation.set(-0.3, 1.1, 0.4);
  camera.updateProjectionMatrix();
  const attenduP = resolveCameraWorld(camera).getWorldPosition(new THREE.Vector3());
  const attenduQ = camera.getWorldQuaternion(new THREE.Quaternion());
  const obtenu = enginePose(readCameraWorld(createEngineCamera(), camera));
  assertBits(obtenu.position, attenduP.toArray());
  const proche = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  assert.ok(
    ['x', 'y', 'z', 'w'].every((k, i) =>
      proche(obtenu.quaternion[i], (attenduQ as unknown as Record<string, number>)[k]),
    ),
  );
});
