// Ce que l'ÉLAGAGE PAR LE HAUT retire vraiment, mesuré sur la carte : la taille des deux listes
// qu'une image relit après la descente — les candidates qu'elle liste, et les vivantes que
// `dagWanted` en garde. Ce sont elles que les cinq passes suivantes parcourent, une grappe par fil.
//
// Deux textes de noyau sur la même scène, la même caméra et le même seuil : celui qui est livré, et
// le même dont `floorPrunes` rend toujours faux — la descente d'avant ce lot, au caractère près
// ailleurs. Les pages retenues doivent être IDENTIQUES : l'élagage ne retire que des sous-arbres
// dont aucune grappe n'était assez fine. Ce que la mesure publie, c'est donc un travail évité, pas
// une coupe changée.
//
// node --experimental-strip-types test/justesse/elagage-haut-gpu.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraSelectionUniforms } from '../../packages/sdk-browser/gpuSelection.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../packages/sdk-browser/gpuDagSelection.ts';
import { DAG_SELECTION_SHADER } from '../../packages/sdk-browser/gpuDagShader.ts';
import { scenePages, sceneRoots } from '../../packages/sdk-browser/gpuDagCutFrontierScene.ts';
import { selectionGpu } from './noyauSelectionGpu.mjs';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';

const VIEWPORT = [1280, 720];
const POSES = [
  ['pose immobile', 0, 16, 1],
  ['de biais', 9, 14, 1],
  ['de loin', 0, 60, 1],
  ['au contact', 1.5, 3, 1],
];
/** Le noyau d'avant le lot : même texte, l'élagage par le haut désarmé par sa seule garde. */
const GARDE =
  'fn floorPrunes(w:u32,flags:u32,sphere:vec4f,error:f32,e:mat4x4f,stretch:f32,focal:f32)->bool{\n';
const SANS_PLANCHER = DAG_SELECTION_SHADER.replace(GARDE, `${GARDE} return false;\n`);
assert.notEqual(SANS_PLANCHER, DAG_SELECTION_SHADER, 'la garde de `floorPrunes` a changé de forme');

const pages = scenePages(2048, 8);
const camera = new THREE.PerspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200);
const cas = POSES.map(([nom, x, z, seuil]) => {
  const roots = sceneRoots(
    pages,
    Array.from({ length: 4 }, (_, w) =>
      new THREE.Matrix4().makeTranslation((w % 2) * 6.5 - 3.25, Math.floor(w / 2) * 6.5 - 3.25, 0),
    ),
    true,
  );
  camera.position.set(x, 0, z);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), seuil, VIEWPORT);
  // Le noyau travaille dans le repère de rendu : les matrices monde y sont ramenées, comme le
  // moteur les lui porte, sans quoi vue relative et monde absolu se mêleraient dans la formule.
  return {
    nom,
    packed: packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld),
    uniforms,
  };
});

// Les deux passages se suivent : un seul appareil ouvert à la fois, et les octets d'un cas ne
// traversent vers la page qu'une fois par passage.
const avec = await selectionGpu(cas);
const sans = await selectionGpu(cas, SANS_PLANCHER);
for (const gpu of [avec, sans]) {
  assert.equal(gpu.indisponible ?? null, null);
  assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);
}
const part = (retire, de) => Number(((100 * retire) / Math.max(1, de)).toFixed(1));
const lignes = cas.map(({ nom }) => {
  const a = avec.resultats.find((r) => r.nom === nom),
    s = sans.resultats.find((r) => r.nom === nom);
  return {
    pose: nom,
    retenues: a.pages.length,
    candidatesSansPlancher: s.candidates,
    candidatesAvecPlancher: a.candidates,
    candidatesRetireesPourCent: part(s.candidates - a.candidates, s.candidates),
    vivantesSansPlancher: s.vivantes,
    vivantesAvecPlancher: a.vivantes,
    vivantesRetireesPourCent: part(s.vivantes - a.vivantes, s.vivantes),
    memesPages: a.pages.length === s.pages.length && a.pages.every((p, i) => p === s.pages[i]),
  };
});
console.log(
  JSON.stringify({ pages: cas[0].packed.pageCount, adaptateur: avec.adaptateur, lignes }, null, 2),
);
for (const ligne of lignes) {
  assert.ok(ligne.memesPages, `${ligne.pose} : l'élagage change la coupe`);
  assert.ok(
    ligne.candidatesAvecPlancher < ligne.candidatesSansPlancher,
    `${ligne.pose} : rien élagué`,
  );
}
