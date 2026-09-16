// Défaut 2 (`setTransform` perd le cisaillement) : ce que le moteur envoie au GPU pour placer une
// primitive est `root.world`, et le noyau WGSL de sélection ramène les plans du tronc dans l'espace
// de cette matrice. Le test exécute ce noyau dans Chromium WebGPU sur la même page vue par la même
// caméra, une fois avec la matrice demandée (cisaillée) et une fois avec sa recomposition
// translation-rotation-échelle — ce que `setTransform` posait avant ce lot. Les deux verdicts
// diffèrent : la perte du cisaillement n'était pas une approximation, elle changeait la page
// sélectionnée. `selectionGpu` vient de `packages/sdk-browser/bench/justesse/noyauSelectionGpu.mjs` ;
// Playwright, de `render-tech-lab`, en lecture seule.
//
// node --experimental-strip-types test/cisaillementTransform.browser.mjs
// (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OPEN_CONE } from '../packages/sdk-browser/pageCone.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../packages/sdk-browser/gpuDagSelection.ts';
import { cameraSelectionUniforms } from '../packages/sdk-browser/gpuSelection.ts';
import { cameraMoteur } from '../packages/sdk-browser/cameraFixture.ts';
import { selectionGpu } from '../packages/sdk-browser/bench/justesse/noyauSelectionGpu.mjs';

const VIEWPORT = [1000, 1000];
// Boîte locale unité : cisaillée, elle couvre x ∈ [-4, 4] ; recomposée en TRS, x ∈ [-2,364, 2,364].
const MIN = [-1, -1, -1],
  MAX = [1, 1, 1];

/** La matrice demandée : `y` pousse `x`, deux axes non orthogonaux. */
const cisaillee = () => new THREE.Matrix4().set(1, 3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** Ce que le défaut posait : la même matrice réduite à un produit translation-rotation-échelle. */
function recomposee(source) {
  const position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    echelle = new THREE.Vector3();
  source.decompose(position, rotation, echelle);
  return new THREE.Matrix4().compose(position, rotation, echelle);
}

function empaquete(world, sphere) {
  return packDagSelection([
    {
      world,
      pages: [
        { url: '0', lodError: 0, parentError: null, sphere, min: MIN, max: MAX, cone: OPEN_CONE },
      ],
    },
  ]);
}

/** Une vue étroite sur `x` : seule la boîte cisaillée y entre. */
function vue(x, fov) {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(x, 0, 10);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  return cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
}

const exacte = cisaillee(),
  approchee = recomposee(exacte);
assert.notDeepEqual(
  Array.from(approchee.elements),
  Array.from(exacte.elements),
  'la reproduction suppose deux matrices différentes',
);

const sphereEtroite = [3.5, 0, 0, 1],
  sphereLarge = [0, 0, 0, 5];
/** Un appel du noyau : la page empaquetée DANS LE REPÈRE DE RENDU de sa vue — l'œil en est
 *  l'origine —, comme l'entrée d'image la porte à la carte. Empaqueter en monde absolu sous une vue
 *  relative mêlerait deux repères dans la même formule, et le tronc trancherait faux. */
const appel = (nom, world, sphere, uniforms) => ({
  nom,
  packed: packedWorldsToRenderOrigin(empaquete(world, sphere), [{ world }], uniforms.cameraWorld),
  uniforms,
});

const etroite = vue(3.5, 10),
  large = vue(0, 60);
const appels = [
  appel('etroite:exacte', exacte, sphereEtroite, etroite),
  appel('etroite:recomposee', approchee, sphereEtroite, etroite),
  appel('large:exacte', exacte, sphereLarge, large),
  appel('large:recomposee', approchee, sphereLarge, large),
];

const gpu = await selectionGpu(appels);
const pages = (nom) => gpu.resultats?.find((r) => r.nom === nom)?.pages ?? null;
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      compilation: gpu.compilation ?? [],
      erreurs: gpu.erreurs ?? [],
      indisponible: gpu.indisponible ?? null,
      resultats: gpu.resultats,
    },
    null,
    2,
  ),
);

assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
assert.deepEqual(gpu.compilation ?? [], []);
assert.deepEqual(gpu.erreurs ?? [], []);

assert.deepEqual(pages('large:exacte'), [0], 'témoin : de face et de loin, la page est retenue');
assert.deepEqual(
  pages('large:recomposee'),
  [0],
  'témoin : le paquet recomposé est sain, il est retenu dans la vue large',
);
assert.deepEqual(
  pages('etroite:exacte'),
  [0],
  'la matrice demandée porte la page jusque dans la vue étroite',
);
assert.deepEqual(
  pages('etroite:recomposee'),
  [],
  'défaut 2 : la recomposition TRS sort la page du tronc — le noyau WGSL ne sélectionne pas la même',
);

console.log(
  'OK : 2 matrices, 2 vues, 4 exécutions du noyau WGSL — voir test/cisaillementTransform.browser.mjs',
);
