// Lot 3, mathFrustum.ts : plans normalisés du tronc en profondeur INVERSÉE, plans bruts de découpe,
// et plans ramenés en repère local — chacun confronté à une référence bâtie avec les primitives de
// Three.js (Frustum, Vector4, Matrix4), au bit près.
//
// La profondeur du moteur est inversée : le plan qui borne le PROCHE est celui que la profondeur
// directe appelait LOIN, et réciproquement. Les six plans d'une même matrice sont donc exactement
// ceux de la référence, les deux derniers échangés — et c'est cet échange, et rien d'autre, que
// `permuteProcheLoin` décrit.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipPlanesFromMatrix, frustumPlanesFromMatrix, frustumPlanesToLocal } from './index.ts';
import { assertBits } from './bench/oracles/volumes.mjs';

/** Les six plans de Three.js recopiés à plat, normal puis constante. La référence est toujours lue
 *  en découpe `[0, 1]` : c'est la plage du moteur, et seul le SENS de la profondeur y est inversé —
 *  ce qui échange les deux derniers plans, et rien d'autre. */
function planesFromThreeFrustum(
  m: THREE.Matrix4,
  Type: Float64ArrayConstructor | Float32ArrayConstructor,
) {
  const tronc = new THREE.Frustum().setFromProjectionMatrix(m, THREE.WebGPUCoordinateSystem);
  const sortie = new Type(24);
  tronc.planes.forEach((p, i) =>
    sortie.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4),
  );
  return sortie;
}

/** La référence en découpe `[0, 1]`, ses deux derniers plans échangés : ce que la profondeur
 *  inversée attend, terme pour terme. */
function permuteProcheLoin(planes: Float64Array | Float32Array) {
  const sortie = planes.slice();
  sortie.set(planes.subarray(20, 24), 16);
  sortie.set(planes.subarray(16, 20), 20);
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
      frustumPlanesFromMatrix(obtenu, m.elements);
      assertBits(obtenu, permuteProcheLoin(planesFromThreeFrustum(m, Float64Array)));
    });
  }
}

test('frustumPlanesFromMatrix en simple précision arrondit une seule fois, comme un uniforme Float32', () => {
  const m = camera(true, false);
  const obtenu = new Float32Array(24);
  frustumPlanesFromMatrix(obtenu, m.elements);
  assertBits(obtenu, permuteProcheLoin(planesFromThreeFrustum(m, Float32Array)));
});

test('clipPlanesFromMatrix rend les sommes et différences brutes des lignes de la matrice', () => {
  const m = camera(false, false);
  const obtenu = new Float64Array(24);
  clipPlanesFromMatrix(obtenu, m.elements);
  assertBits(obtenu, clipPlanesAttendus(m));
});

test('frustumPlanesToLocal ramène chaque plan par p · m, comme p transformé par la transposée de m', () => {
  const m = camera(false, false);
  const placement = new THREE.Matrix4().compose(
    new THREE.Vector3(2, -1, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.9, 1.1)),
    new THREE.Vector3(-2, 1.5, 4),
  );
  const planes = new Float32Array(24);
  frustumPlanesFromMatrix(planes, m.elements);
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

/** Les six plans bruts (non normalisés) recopiés depuis les primitives Three.js, les deux derniers
 *  déjà dans l'ordre de la profondeur inversée —
 *  même construction que le test de `clipPlanesFromMatrix` ci-dessus, factorisée pour l'entrelacement
 *  ci-dessous. */
function clipPlanesAttendus(m: THREE.Matrix4) {
  const e = m.elements;
  const w = new THREE.Vector4(e[3], e[7], e[11], e[15]);
  const lignes = [
    new THREE.Vector4(e[0], e[4], e[8], e[12]),
    new THREE.Vector4(e[1], e[5], e[9], e[13]),
    new THREE.Vector4(e[2], e[6], e[10], e[14]),
  ];
  const attendu = new Float64Array(24);
  // Quatre plans de côté, puis le LOIN — la seule ligne de profondeur, sans `w` — et le PROCHE.
  [
    [0, -1],
    [0, 1],
    [1, 1],
    [1, -1],
    [2, 0],
    [2, -1],
  ].forEach(([k, signe], i) => {
    const p = signe === 0 ? new THREE.Vector4().copy(lignes[k]) : new THREE.Vector4().copy(w);
    if (signe > 0) p.add(lignes[k]);
    else if (signe < 0) p.sub(lignes[k]);
    attendu.set([p.x, p.y, p.z, p.w], i * 4);
  });
  return attendu;
}

// perf(socle) e5509b57 : les quatre composantes d'un plan passent en arguments de `writePlane` et
// non plus par un tampon de module (`plane`, un `Float64Array(4)` partagé entre tous les appels).
// Sans ce tampon, deux calculs de tronc enchevêtrés — chacun dans son propre `out` — ne peuvent plus
// se marcher dessus ; il n'y a plus rien à allouer ni à réutiliser par appel. Le vérifier avec deux
// troncs très différents dont les écritures sont entrelacées à la main, comparés chacun à la
// référence Three.js.
test('frustumPlanesFromMatrix et clipPlanesFromMatrix : aucun tampon partagé, deux troncs entrelacés restent indépendants', () => {
  const m1 = camera(false, false);
  const m2 = camera(true, true);
  const obtenu1 = new Float64Array(24);
  const obtenu2 = new Float64Array(24);
  const clip1 = new Float64Array(24);
  const clip2 = new Float64Array(24);
  // Écritures entrelacées : si une composante transitait encore par un tampon de module partagé,
  // cet ordre la ferait écraser par l'appel suivant avant sa lecture.
  frustumPlanesFromMatrix(obtenu1, m1.elements);
  clipPlanesFromMatrix(clip2, m2.elements);
  frustumPlanesFromMatrix(obtenu2, m2.elements);
  clipPlanesFromMatrix(clip1, m1.elements);
  assertBits(obtenu1, permuteProcheLoin(planesFromThreeFrustum(m1, Float64Array)));
  assertBits(obtenu2, permuteProcheLoin(planesFromThreeFrustum(m2, Float64Array)));
  assertBits(clip1, clipPlanesAttendus(m1));
  assertBits(clip2, clipPlanesAttendus(m2));
});

test('une matrice de projection NaN ou nulle rend des plans NaN ou infinis, sans lever', () => {
  for (const m of [new Array(16).fill(NaN), new Array(16).fill(0)]) {
    const sortie = new Float64Array(24);
    assert.doesNotThrow(() => frustumPlanesFromMatrix(sortie, m));
    assert.doesNotThrow(() => clipPlanesFromMatrix(sortie, m));
  }
});
