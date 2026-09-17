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
// node --experimental-strip-types test/justesse/plancher-erreur-cpu-gpu.mjs
// (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { selectVisiblePages } from '../../packages/sdk-browser/pageSelectionCut.ts';
import { cullingBounds } from '../../packages/sdk-browser/pageSelectionCutBounds.ts';
import { cameraSelectionUniforms } from '../../packages/sdk-browser/gpuSelection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../packages/sdk-browser/gpuDagSelection.ts';
import { descenteComptee } from '../../packages/sdk-browser/gpuDagCutFrontierFixture.ts';
import { scenePages, sceneRoots } from '../../packages/sdk-browser/gpuDagCutFrontierScene.ts';
import { selectionGpu } from './noyauSelectionGpu.mjs';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';

const VIEWPORT = [1280, 720];
/** Le quatrième champ est le seuil ; le cinquième, les profondeurs où la pyramide est POSÉE. Une
 *  seule profondeur ne retient qu'un étage de détail, donc une seule bande d'erreur et une seule
 *  priorité : l'égalité des priorités s'y vérifierait sur une suite constante. Éloignées, les
 *  copies se résolvent à des étages différents, comme dans une scène réelle. */
const POSES = [
  ['face, 1 px', 0, 16, 1, [0]],
  ['face, 4 px', 0, 16, 4, [0]],
  ['de biais, 1 px', 9, 14, 1, [0]],
  ['de loin, 0,25 px', 0, 60, 0.25, [0]],
  ['quatre profondeurs, 1 px', 0, 16, 1, [0, 12, 30, 70]],
];
const pages = scenePages(4096, 8);
const camera = new THREE.PerspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200);

const cas = [];
for (const [nom, x, z, seuil, profondeurs] of POSES) {
  const mondes = profondeurs.map((p) => new THREE.Matrix4().makeTranslation(0, 0, -p));
  const roots = sceneRoots(pages, mondes);
  camera.position.set(x, 0, z);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), seuil, VIEWPORT);
  // Le noyau travaille dans le repère de rendu : les matrices monde empaquetées y sont ramenées,
  // comme le moteur les lui porte, sans quoi vue relative et monde absolu se mêleraient.
  const packed = packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld);
  // La coupe processeur prend les mêmes nœuds avec ses propres bornes, en f64 : c'est la référence.
  const bornes = cullingBounds(roots[0].culling, pages);
  const cpu = selectVisiblePages(
    mondes.map((monde) => ({
      world: monde,
      pages,
      cones: false,
      culling: { ...roots[0].culling, bounds: bornes },
    })),
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
    oracle: evaluateDagSelectionKernel(packed, uniforms),
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
    retenuesOracle: c.oracle.pageIds.length,
    retenuesGpu: lu?.pages.length ?? null,
    ecartOracleGpu: lu ? Math.abs(lu.pages.length - c.oracle.pageIds.length) : null,
    // Les totaux de triangles que la carte tient, contre ceux que l'oracle rejoue au même endroit.
    // Sans résidence, tout ce que la coupe retient part au dessin et rien ne creuse de trou.
    trianglesOracle: c.oracle.selectedTriangles,
    trianglesGpu: lu?.selectedTriangles ?? null,
    dessinesGpu: lu?.drawnTriangles ?? null,
    trouGpu: lu?.uncoveredTriangles ?? null,
    // L'ORDRE que la carte publie, contre celui de l'oracle : la priorité de chaque demande décide
    // qui l'hôte téléverse d'abord, et un ordre qui ne serait pas celui-là ne servirait à rien.
    // Comparés sur la suite des priorités, pas sur les pages : deux pages d'un même pas sont
    // interchangeables des deux côtés, et le pas est ce que le classement lit.
    // La carte écrit ses demandes dans l'ordre d'un compteur atomique, donc dans aucun : c'est la
    // relecture qui classe (`parseDagOutput`). Ce qui se compare ici est donc la SUITE DES
    // PRIORITÉS une fois classée, de part et d'autre.
    prioritesGpu: lu ? lu.demandes.map((mot) => mot >>> 22).sort((a, b) => b - a) : null,
    prioritesOracle: c.oracle.requestPriorities,
  };
});
// Les suites de priorités font des milliers d'entrées : publiées en résumé, comparées en entier.
const resume = (suite) =>
  suite && { pas: new Set(suite).size, haute: suite[0], basse: suite[suite.length - 1] };
console.log(
  JSON.stringify(
    {
      pages: pages.length,
      adaptateur: gpu.adaptateur,
      lignes: lignes.map(({ prioritesGpu, prioritesOracle, ...reste }) => ({
        ...reste,
        prioritesGpu: resume(prioritesGpu),
        memesPriorites: JSON.stringify(prioritesGpu) === JSON.stringify(prioritesOracle),
      })),
    },
    null,
    2,
  ),
);
// Au moins une pose doit porter PLUSIEURS pas de priorité : sur une suite constante, l'égalité des
// priorités ne dirait rien, et le banc deviendrait vert sans plus rien prouver.
assert.ok(
  lignes.some((ligne) => new Set(ligne.prioritesGpu).size > 1),
  'aucune pose ne porte plus d’un pas de priorité',
);
for (const ligne of lignes) {
  assert.ok(ligne.sousArbresElagues > 0, `${ligne.pose} : aucun sous-arbre élagué`);
  assert.equal(ligne.ecartOracleGpu, 0, `${ligne.pose} : la carte et l'oracle divergent`);
  assert.equal(ligne.retenuesGpu, ligne.retenuesCpu, `${ligne.pose} : la carte perd de la coupe`);
  assert.ok(ligne.trianglesGpu > 0, `${ligne.pose} : aucun triangle compté`);
  assert.equal(
    ligne.trianglesGpu,
    ligne.trianglesOracle,
    `${ligne.pose} : les totaux de la carte et de l'oracle divergent`,
  );
  // L'invariant que le processeur sommait : la coupe vaut le dessin plus le trou.
  assert.equal(
    ligne.trianglesGpu - ligne.dessinesGpu - ligne.trouGpu,
    0,
    `${ligne.pose} : selected − drawn − uncovered ≠ 0`,
  );
  // La priorité de chaque demande décide qui l'hôte téléverse d'abord : la carte et l'oracle
  // doivent donner la même suite, sans quoi l'ordre livré ne serait pas celui qui a été prouvé.
  assert.deepEqual(
    ligne.prioritesGpu,
    ligne.prioritesOracle,
    `${ligne.pose} : la carte et l'oracle ne donnent pas les mêmes priorités`,
  );
}
