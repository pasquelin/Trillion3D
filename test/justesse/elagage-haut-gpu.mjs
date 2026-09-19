// What TOP-DOWN PRUNING actually removes, measured on the GPU: the size of the two lists a frame
// rereads after the descent — the candidates it lists, and the live ones `dagWanted` keeps. Those
// are what the next five passes walk, one cluster per thread.
//
// Two kernel texts on the same scene, camera and threshold: the shipped one, and the same whose
// `floorPrunes` always returns false — the descent from before this batch, character for character
// elsewhere. Kept pages must be IDENTICAL: pruning only removes subtrees of which no cluster was
// fine enough. What the measurement publishes is therefore work avoided, not a changed cut.
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
/** The kernel from before the batch: same text, top-down pruning disarmed by its sole guard. */
const GARDE =
  'fn floorPrunes(w:u32,flags:u32,sphere:vec4f,error:f32,e:mat4x4f,stretch:f32,focal:f32)->bool{\n';
const SANS_PLANCHER = DAG_SELECTION_SHADER.replace(GARDE, `${GARDE} return false;\n`);
assert.notEqual(SANS_PLANCHER, DAG_SELECTION_SHADER, 'the `floorPrunes` guard has changed shape');

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
  // The kernel works in the render frame: world matrices are brought there, as the engine carries
  // them, otherwise relative view and absolute world would mix in the formula.
  return {
    nom,
    packed: packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld),
    uniforms,
  };
});

// The two passes follow each other: one device open at a time, and a case's bytes cross to the
// page only once per pass.
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
  assert.ok(ligne.memesPages, `${ligne.pose}: pruning changes the cut`);
  assert.ok(
    ligne.candidatesAvecPlancher < ligne.candidatesSansPlancher,
    `${ligne.pose}: nothing pruned`,
  );
}
