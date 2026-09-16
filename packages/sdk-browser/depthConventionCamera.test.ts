// Défaut : `cameraWorld` lisait `coordinateSystem` et en tirait les six plans du tronc, pendant que
// la vue-projection envoyée au GPU, les bornes Hi-Z et le raster de visibilité ramenaient TOUJOURS
// `[-1, 1]` vers `[0, 1]` — une caméra hôte déjà en `[0, 1]` (WebGPUCoordinateSystem) repassait par
// une conversion déjà faite. `depthConvention.ts` est désormais le seul site qui convertit.
//
// Deux caméras hôte de MÊME pose, MÊME fov/aspect/near/far, l'une WebGL (`[-1, 1]`), l'autre
// WebGPU-native (`[0, 1]`, projection déjà remappée par Three) : les trois nombres qui dépendent de
// la profondeur — la vue-projection envoyée au GPU (`viewProjectionZeroToOne`), la borne Hi-Z basse
// d'une boîte (`projectCornersInto`) et la profondeur d'un sommet du raster de visibilité
// (`projectVisibilityVertex`) — doivent sortir aux MÊMES valeurs dans les deux conventions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEngineCamera, readCameraWorld } from './cameraWorld.ts';
import { viewProjectionZeroToOne } from './depthConvention.ts';
import { HIZ_BOUNDS_VALUES, projectCornersInto } from './hizCorners.ts';
import { projectVisibilityVertex } from './visibilityProjection.ts';
import { IDENTITY_ELEMENTS } from './matrixElements.ts';
import { boxCornersInto } from '../sdk-core/index.ts';

const LARGEUR = 800,
  HAUTEUR = 450;

/** Une caméra hôte perspective de pose et d'optique fixées, dans une convention de profondeur. */
function camera(coordinateSystem: number) {
  const cam = new THREE.PerspectiveCamera(50, LARGEUR / HAUTEUR, 0.1, 1000);
  cam.position.set(2, 1, 8);
  cam.lookAt(0, 0, 0);
  cam.coordinateSystem = coordinateSystem;
  cam.updateProjectionMatrix();
  return readCameraWorld(createEngineCamera(), cam);
}

function proche(
  obtenu: ArrayLike<number>,
  attendu: ArrayLike<number>,
  tolerance: number,
  quoi: string,
) {
  for (let i = 0; i < attendu.length; i++)
    assert.ok(
      Math.abs(obtenu[i] - attendu[i]) <= tolerance,
      `${quoi}[${i}] : ${obtenu[i]} au lieu de ${attendu[i]}`,
    );
}

/** Une boîte monde en face des deux caméras, ni derrière ni coupant le plan proche. */
const CORNERS = new Float64Array(24);
boxCornersInto(CORNERS, 0, -1, -1, -1, 1, 1, 1, IDENTITY_ELEMENTS);

const webGL = camera(THREE.WebGLCoordinateSystem);
const webGPU = camera(THREE.WebGPUCoordinateSystem);

test(
  'une caméra hôte WebGPU-native et son équivalente WebGL donnent la même vue-projection ' +
    'envoyée au GPU (justesse géométrique : équivalence des deux conventions)',
  () => {
    assert.equal(webGL.depthZeroToOne, false, 'convention WebGL : [-1, 1]');
    assert.equal(webGPU.depthZeroToOne, true, 'convention WebGPU : déjà [0, 1]');
    const outGL = new Float64Array(16),
      outGPU = new Float64Array(16);
    viewProjectionZeroToOne(outGL, webGL);
    viewProjectionZeroToOne(outGPU, webGPU);
    proche(outGL, outGPU, 1e-9, 'vue-projection [0, 1]');
  },
);

test(
  'les mêmes bornes Hi-Z (lowZ) pour la même boîte, dans les deux conventions ' +
    '(justesse géométrique : équivalence des deux conventions)',
  () => {
    const intoGL = new Float64Array(HIZ_BOUNDS_VALUES),
      intoGPU = new Float64Array(HIZ_BOUNDS_VALUES);
    projectCornersInto(
      CORNERS,
      0,
      webGL.view,
      webGL.viewProjection,
      webGL.near,
      LARGEUR,
      HAUTEUR,
      webGL.depthZeroToOne,
      intoGL,
      0,
    );
    projectCornersInto(
      CORNERS,
      0,
      webGPU.view,
      webGPU.viewProjection,
      webGPU.near,
      LARGEUR,
      HAUTEUR,
      webGPU.depthZeroToOne,
      intoGPU,
      0,
    );
    assert.equal(intoGL[5], 0, 'la boîte doit être projetée, pas rejetée');
    assert.equal(intoGPU[5], 0, 'la boîte doit être projetée, pas rejetée');
    assert.deepEqual(
      [intoGL[0], intoGL[1], intoGL[2], intoGL[3]],
      [intoGPU[0], intoGPU[1], intoGPU[2], intoGPU[3]],
      'rectangle écran identique',
    );
    assert.ok(
      Math.abs(intoGL[4] - intoGPU[4]) < 1e-9,
      `lowZ ${intoGL[4]} (WebGL) au lieu de ${intoGPU[4]} (WebGPU)`,
    );
  },
);

test(
  'le même ndcZ du raster de visibilité pour le même sommet, dans les deux conventions ' +
    '(justesse géométrique : équivalence des deux conventions)',
  () => {
    const position = { getX: () => 0.3, getY: () => -0.2, getZ: () => 0.5 };
    const matrix = { elements: IDENTITY_ELEMENTS };
    const pGL = projectVisibilityVertex(matrix, position, 0, webGL, LARGEUR, HAUTEUR);
    const pGPU = projectVisibilityVertex(matrix, position, 0, webGPU, LARGEUR, HAUTEUR);
    assert.ok(pGL && pGPU, 'le sommet doit se projeter dans les deux conventions');
    assert.ok(Math.abs(pGL!.x - pGPU!.x) < 1e-9, 'x écran identique');
    assert.ok(Math.abs(pGL!.y - pGPU!.y) < 1e-9, 'y écran identique');
    assert.ok(
      Math.abs(pGL!.z - pGPU!.z) < 1e-9,
      `ndcZ ${pGL!.z} (WebGL) au lieu de ${pGPU!.z} (WebGPU)`,
    );
  },
);

test(
  'une caméra WebGL rend, bit pour bit, ce que rendait le remap systématique d’avant le lot ' +
    '(équivalence à l’ancien code)',
  () => {
    // AVANT LE LOT : chaque site remappait TOUJOURS `[-1, 1]` vers `[0, 1]`, quelle que soit la
    // convention de l'hôte — exactement `remap × viewProjection`. Pour une caméra WebGL, c'est
    // encore ce qu'il faut faire : ce calcul à la main, terme à terme sur la vue-projection brute
    // (sans passer par `viewProjectionZeroToOne` ni `multiplyMatrix4`), en est le témoin indépendant.
    // `remapMinusOneToOne` ne touche que la ligne z du résultat : nouvelle_ligne_z =
    // 0,5 · (ancienne_ligne_z + ancienne_ligne_w), les lignes x, y, w restant celles de `M`.
    const vp = webGL.viewProjection;
    const main = new Float64Array(16);
    for (let col = 0; col < 4; col++) {
      const base = col * 4;
      main[base] = vp[base];
      main[base + 1] = vp[base + 1];
      main[base + 2] = 0.5 * (vp[base + 2] + vp[base + 3]);
      main[base + 3] = vp[base + 3];
    }
    const out = new Float64Array(16);
    viewProjectionZeroToOne(out, webGL);
    for (let i = 0; i < 16; i++)
      assert.ok(
        Object.is(out[i], main[i]),
        `[${i}] : ${out[i]} au lieu de ${main[i]} (calcul à la main d’avant le lot)`,
      );
  },
);
