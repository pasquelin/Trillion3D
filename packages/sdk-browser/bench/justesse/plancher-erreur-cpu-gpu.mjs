// Cohérence CPU/GPU de l'ÉLAGAGE PAR LE HAUT : le plancher d'erreur du sous-arbre, rangé dans le
// nœud par `packCullingNodes` et projeté par `errorFloor` en WGSL, ne doit retirer aucune grappe
// que la coupe aurait prise.
//
// La borne est un minorant de l'erreur projetée de tout le sous-arbre : au-dessus du seuil, aucune
// grappe n'est assez fine. Un minorant SURESTIMÉ retire de la géométrie sans rien dire. Le miroir
// processeur (`errorFloorAt`) travaille en f64 sur les valeurs empaquetées, le noyau en f32 : c'est
// cet écart-là que le banc mesure, sur la carte, et non sur un double.
//
// Trois coupes comparées, sur une pyramide de huit étages de détail et quatre poses : la coupe
// processeur (`selectVisiblePages`), l'oracle Node du noyau et le noyau WGSL exécuté dans Chromium.
// Le compte des sous-arbres élagués est publié : sans élagage, la preuve ne porterait sur rien.
//
// node --experimental-strip-types packages/sdk-browser/bench/justesse/plancher-erreur-cpu-gpu.mjs
// (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { selectVisiblePages } from '../../pageSelectionCut.ts';
import { cullingBounds } from '../../pageSelectionCutBounds.ts';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../gpuDagSelection.ts';
import { descenteComptee } from '../../gpuDagCutFrontierFixture.ts';
import { scenePages, sceneRoots } from '../../gpuDagCutFrontierScene.ts';
import { selectionGpu } from './noyauSelectionGpu.mjs';
import { cameraMoteur } from '../../cameraFixture.ts';

const VIEWPORT = [1280, 720];
const POSES = [
  ['face, 1 px', 0, 16, 1],
  ['face, 4 px', 0, 16, 4],
  ['de biais, 1 px', 9, 14, 1],
  ['de loin, 0,25 px', 0, 60, 0.25],
];
const pages = scenePages(4096, 8);
const camera = new THREE.PerspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200);

const cas = [];
for (const [nom, x, z, seuil] of POSES) {
  const world = new THREE.Matrix4().makeTranslation(0, 0, 0);
  const roots = sceneRoots(pages, [world]);
  camera.position.set(x, 0, z);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), seuil, VIEWPORT);
  // Le noyau travaille dans le repère de rendu : les matrices monde empaquetées y sont ramenées,
  // comme le moteur les lui porte, sans quoi vue relative et monde absolu se mêleraient.
  const packed = packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld);
  // La coupe processeur prend les mêmes nœuds avec ses propres bornes, en f64 : c'est la référence.
  const cpu = selectVisiblePages(
    [
      {
        world,
        pages,
        cones: false,
        culling: { ...roots[0].culling, bounds: cullingBounds(roots[0].culling, pages) },
      },
    ],
    cameraMoteur(camera),
    { pixelError: seuil, viewport: VIEWPORT },
  );
  cas.push({
    nom,
    packed,
    uniforms,
    seuil,
    cpu: cpu.shown.length,
    elagages: descenteComptee(packed, uniforms, true).plancherCoupe,
    oracle: evaluateDagSelectionKernel(packed, uniforms).pageIds.length,
  });
}

const gpu = await selectionGpu(cas.map(({ nom, packed, uniforms }) => ({ nom, packed, uniforms })));
assert.equal(gpu.indisponible ?? null, null);
assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);
const lignes = cas.map((c) => {
  const lu = gpu.resultats.find((r) => r.nom === c.nom);
  return {
    pose: c.nom,
    seuil: c.seuil,
    sousArbresElagues: c.elagages,
    retenuesCpu: c.cpu,
    retenuesOracle: c.oracle,
    retenuesGpu: lu?.pages.length ?? null,
    ecartOracleGpu: lu ? Math.abs(lu.pages.length - c.oracle) : null,
  };
});
console.log(JSON.stringify({ pages: pages.length, adaptateur: gpu.adaptateur, lignes }, null, 2));
for (const ligne of lignes) {
  assert.ok(ligne.sousArbresElagues > 0, `${ligne.pose} : aucun sous-arbre élagué`);
  assert.equal(ligne.ecartOracleGpu, 0, `${ligne.pose} : la carte et l'oracle divergent`);
  assert.equal(ligne.retenuesGpu, ligne.retenuesCpu, `${ligne.pose} : la carte perd de la coupe`);
}
