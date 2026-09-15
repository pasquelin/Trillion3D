// Lot M2, mathFrustum.ts : plans normalisés du tronc dans les deux conventions de profondeur (WebGL,
// WebGPU), plans bruts de découpe, et plans ramenés en repère local — chacun confronté à une
// référence bâtie avec les primitives de Three.js (Frustum, Vector4, Matrix4), au bit près.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipPlanesFromMatrix, frustumPlanesFromMatrix, frustumPlanesToLocal } from './index.ts';

function assertBits(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Object.is(actual[i], expected[i]),
      `composante ${i} : ${actual[i]} !== ${expected[i]}`,
    );
}
/** Les six plans de Three.js recopiés à plat, normal puis constante. */
function planesFromThreeFrustum(
  m: THREE.Matrix4,
  webgpu: boolean,
  Type: Float64ArrayConstructor | Float32ArrayConstructor,
) {
  const systeme = webgpu ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
  const tronc = new THREE.Frustum().setFromProjectionMatrix(m, systeme);
  const sortie = new Type(24);
  tronc.planes.forEach((p, i) =>
    sortie.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4),
  );
  return sortie;
}

function camera(webgpu: boolean, orthographique: boolean) {
  const cam = orthographique
    ? new THREE.OrthographicCamera(-8, 8, 5, -5, 0.2, 250)
    : new THREE.PerspectiveCamera(55, 1.4, 0.15, 400);
  cam.coordinateSystem = webgpu ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
  cam.updateProjectionMatrix();
  cam.position.set(3, -2, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}

for (const webgpu of [false, true]) {
  for (const orthographique of [false, true]) {
    test(`frustumPlanesFromMatrix s’accorde avec Frustum.setFromProjectionMatrix (webgpu=${webgpu}, ortho=${orthographique})`, () => {
      const m = camera(webgpu, orthographique);
      const obtenu = new Float64Array(24);
      frustumPlanesFromMatrix(obtenu, m.elements, webgpu);
      assertBits(obtenu, planesFromThreeFrustum(m, webgpu, Float64Array));
    });
  }
}

test('frustumPlanesFromMatrix en simple précision arrondit une seule fois, comme un uniforme Float32', () => {
  const m = camera(true, false);
  const obtenu = new Float32Array(24);
  frustumPlanesFromMatrix(obtenu, m.elements, true);
  assertBits(obtenu, planesFromThreeFrustum(m, true, Float32Array));
});

test('clipPlanesFromMatrix rend les sommes et différences brutes des lignes de la matrice (profondeur WebGL)', () => {
  const m = camera(false, false);
  const e = m.elements;
  const w = new THREE.Vector4(e[3], e[7], e[11], e[15]);
  const lignes = [
    new THREE.Vector4(e[0], e[4], e[8], e[12]),
    new THREE.Vector4(e[1], e[5], e[9], e[13]),
    new THREE.Vector4(e[2], e[6], e[10], e[14]),
  ];
  const attendu = new Float64Array(24);
  [
    [0, -1],
    [0, 1],
    [1, 1],
    [1, -1],
    [2, -1],
    [2, 1],
  ].forEach(([k, signe], i) => {
    const p = new THREE.Vector4().copy(w);
    if (signe > 0) p.add(lignes[k]);
    else p.sub(lignes[k]);
    attendu.set([p.x, p.y, p.z, p.w], i * 4);
  });
  const obtenu = new Float64Array(24);
  clipPlanesFromMatrix(obtenu, m.elements);
  assertBits(obtenu, attendu);
});

test('frustumPlanesToLocal ramène chaque plan par p · m, comme p transformé par la transposée de m', () => {
  const m = camera(false, false);
  const placement = new THREE.Matrix4().compose(
    new THREE.Vector3(2, -1, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.9, 1.1)),
    new THREE.Vector3(-2, 1.5, 4),
  );
  const planes = new Float32Array(24);
  frustumPlanesFromMatrix(planes, m.elements, false);
  const transposee = new THREE.Matrix4().copy(placement).transpose();
  const attendu = new Float64Array(24);
  for (let i = 0; i < 24; i += 4) {
    const p = new THREE.Vector4(
      planes[i],
      planes[i + 1],
      planes[i + 2],
      planes[i + 3],
    ).applyMatrix4(transposee);
    attendu.set([p.x, p.y, p.z, p.w], i);
  }
  const obtenu = new Float64Array(24);
  frustumPlanesToLocal(obtenu, planes, placement.elements);
  assertBits(obtenu, attendu);
});

test('une matrice de projection NaN ou nulle rend des plans NaN ou infinis, sans lever', () => {
  for (const m of [new Array(16).fill(NaN), new Array(16).fill(0)]) {
    const sortie = new Float64Array(24);
    assert.doesNotThrow(() => frustumPlanesFromMatrix(sortie, m, false));
    assert.doesNotThrow(() => clipPlanesFromMatrix(sortie, m));
  }
});
