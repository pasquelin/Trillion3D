// Défaut 1 (rejet par cône à petite échelle) : le noyau WGSL réellement exécuté dans Chromium WebGPU
// doit garder le cas déclencheur de la reproduction (échelle non uniforme 1e-8/1e-6/1e-6, deux vrais
// triangles) et continuer de rejeter un cluster conforme (échelle uniforme et rotation) dont la face
// est dos à la caméra, comme avant ce lot. `selectionGpu` vient de
// `test/justesse/noyauSelectionGpu.mjs` ; Playwright, de `render-tech-lab`, en
// lecture seule.
//
// node --experimental-strip-types test/browser/cone-echelle-non-uniforme.browser.mjs
// (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OPEN_CONE, triangleCone } from '../../packages/sdk-browser/pageCone.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../packages/sdk-browser/gpuDagSelection.ts';
import { cameraSelectionUniforms } from '../../packages/sdk-browser/gpuSelection.ts';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';
import { selectionGpu } from '../justesse/noyauSelectionGpu.mjs';

const VIEWPORT = [1000, 1000];

/** La page empaquetée DANS LE REPÈRE DE RENDU de `uniforms` — l'œil en est l'origine —, comme
 *  l'entrée d'image la porte à la carte. Empaqueter en monde absolu sous une vue relative mêlerait
 *  deux repères dans la même formule, et le tronc comme le cône trancheraient faux. */
function empaquete(world, page, uniforms) {
  return packedWorldsToRenderOrigin(
    packDagSelection([{ world, pages: [{ url: '0', lodError: 0, parentError: null, ...page }] }]),
    [{ world }],
    uniforms.cameraWorld,
  );
}

/** Cas déclencheur : deux vrais triangles, échelle (1e-8, 1e-6, 1e-6), face visible et grande —
 *  identique à `test/justesse/cone-echelle-non-uniforme.mjs`. */
function casDeclencheur() {
  const positions = [0, 0, 0, 1e6, 0, -1e6, 0, 1e6, 0, 0, 0, 0, -1e6, 0, -1e6, 0, -1e6, 0];
  const indices = [0, 1, 2, 3, 4, 5];
  const cone = triangleCone(positions, indices);
  const min = [-1e6, -1e6, -1e6],
    max = [1e6, 1e6, 0];
  const world = new THREE.Matrix4().makeScale(1e-8, 1e-6, 1e-6);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(6, 0, -9);
  camera.lookAt(0, 0, -0.5);
  camera.updateMatrixWorld(true);
  const sphere = [0, 0, -0.5, 2];
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
  return {
    nom: 'declencheur',
    uniforms,
    avecCone: empaquete(world, { sphere, min, max, cone }, uniforms),
    sansCone: empaquete(world, { sphere, min, max, cone: OPEN_CONE }, uniforms),
  };
}

/** Cas conforme hostile : échelle uniforme et rotation, une boîte dos à la caméra doit rester
 *  rejetée exactement comme avant ce lot — la correction ne relâche pas le rejet conforme. */
function casConformeDosCamera() {
  const cone = { axis: [0, 0, 1], angle: Math.PI / 6 };
  const world = new THREE.Matrix4().compose(
    new THREE.Vector3(2, -1, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.5, 0.2)),
    new THREE.Vector3(50, 50, 50),
  );
  const min = [-1, -1, -1],
    max = [1, 1, 1];
  const centre = new THREE.Vector3(0, 0, 0).applyMatrix4(world);
  const normal = new THREE.Matrix3().getNormalMatrix(world);
  const axeMonde = new THREE.Vector3(...cone.axis).applyMatrix3(normal).normalize();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100000);
  camera.position.copy(axeMonde).multiplyScalar(-500).add(centre);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const sphere = [...centre.toArray(), 3];
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
  return {
    nom: 'conformeDosCamera',
    uniforms,
    avecCone: empaquete(world, { sphere, min, max, cone }, uniforms),
    sansCone: empaquete(world, { sphere, min, max, cone: OPEN_CONE }, uniforms),
  };
}

const cas = [casDeclencheur(), casConformeDosCamera()];
const appels = cas.flatMap((c) => [
  { nom: `${c.nom}:avecCone`, packed: c.avecCone, uniforms: c.uniforms },
  { nom: `${c.nom}:sansCone`, packed: c.sansCone, uniforms: c.uniforms },
]);
const gpu = await selectionGpu(appels);
const pages = (nom) => gpu.resultats?.find((r) => r.nom === nom)?.pages ?? null;
const indisponible = gpu.indisponible ?? null;
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      compilation: gpu.compilation ?? [],
      erreurs: gpu.erreurs ?? [],
      indisponible,
      resultats: gpu.resultats,
    },
    null,
    2,
  ),
);

assert.equal(indisponible, null, String(indisponible));
assert.deepEqual(gpu.compilation ?? [], []);
assert.deepEqual(gpu.erreurs ?? [], []);

assert.deepEqual(pages('declencheur:sansCone'), [0], 'témoin : sans cône, la page reste');
assert.deepEqual(
  pages('declencheur:avecCone'),
  [0],
  'défaut 1 : le noyau WGSL rejette la page pourtant visible à petite échelle non uniforme',
);

assert.deepEqual(
  pages('conformeDosCamera:sansCone'),
  [0],
  'témoin : sans cône, la page conforme dos caméra reste',
);
assert.deepEqual(
  pages('conformeDosCamera:avecCone'),
  [],
  'un cluster conforme dont la face est dos à la caméra doit toujours être rejeté',
);

console.log(
  'OK : 2 cas, 4 exécutions du noyau WGSL — voir test/browser/cone-echelle-non-uniforme.browser.mjs',
);
