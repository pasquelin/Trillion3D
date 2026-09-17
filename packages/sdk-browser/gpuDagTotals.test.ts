// Les totaux de triangles ont changé de côté : le processeur les sommait en parcourant la différence
// de coupe (`webgpuCutCounts.ts`), la carte les tient désormais dans `dagMask` (`gpuDagTotalsWgsl.ts`).
//
// Ce test tient les deux moitiés du contrat :
// ① l'invariant que le processeur documentait — `selected − drawn − uncovered = 0` — sur une image
//    où la résidence creuse VRAIMENT un trou, sans quoi il se vérifierait sur zéro ;
// ② l'accord avec la somme processeur, là où les deux définitions coïncident : une coupe dont toutes
//    les pages dessinables ont leurs octets et leur ligne. C'est ce qui autorise à retirer la somme.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from './gpuDagSelection.ts';
import { scenePages, sceneRoots } from './gpuDagCutFrontierScene.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutCounts } from './webgpuCutCounts.ts';
import type { PageRec } from './pageSelection.ts';

const VIEWPORT: [number, number] = [1280, 720];

/** La scène du comptage de frontière, dont chaque page porte un compte de triangles variable, et
 *  dont une sur sept est en mélange : sans cela, `transparentTriangles` s'accorderait sur zéro. */
function scene(seuil: number, z = 16) {
  const pages = scenePages(4096, 8).map((page, i) => ({ ...page, transparent: i % 7 === 0 }));
  const roots = sceneRoots(pages, [new THREE.Matrix4()], true);
  const packed = packDagSelection(roots);
  const uni = uniforms(seuil, z);
  // Le noyau travaille dans le repère de rendu : sans rebasage, vue relative et monde absolu se
  // mêleraient et la coupe serait vide — elle le serait en silence, ce qui vérifierait tout sur rien.
  packedWorldsToRenderOrigin(packed, roots, uni.cameraWorld);
  return { pages, packed, uni };
}

/** Le catalogue que la somme processeur lit : mêmes rangs que la coupe, mêmes triangles. */
const catalogue = (pages: ReturnType<typeof scene>['pages']) =>
  pages.map(
    (page, id) =>
      ({
        id,
        url: page.url,
        triangles: page.triangles,
        transparent: page.transparent,
        array: Uint32Array.of(0, 1, 2),
      }) as unknown as PageRec,
  );

function uniforms(seuil: number, z = 16) {
  const camera = new THREE.PerspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200);
  camera.position.set(0, 0, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return cameraSelectionUniforms(cameraMoteur(camera), seuil, VIEWPORT);
}

test('les trois totaux sont pris sur la coupe dessinable entière, trou compris', () => {
  const { pages, packed, uni } = scene(1);
  // Une page sur trois résidente : la coupe voudra dessiner ce qui manque, et le trou sera réel.
  const resident = Uint32Array.from({ length: packed.pageCount }, (_, id) => (id % 3 ? 0 : 1));
  const releve = evaluateDagSelectionKernel(packed, uni, resident);
  const { selectedTriangles, drawnTriangles, uncoveredTriangles, drawablePageIds } = releve;
  assert.ok(
    uncoveredTriangles! > 0,
    'la résidence doit creuser un trou, sinon l’invariant est vide',
  );
  assert.ok(drawnTriangles! > 0, 'et l’image doit quand même dessiner');
  assert.equal(selectedTriangles! - drawnTriangles! - uncoveredTriangles!, 0);
  // `drawn` est exactement la somme des pages que le relevé déclare dessinables — ni plus, ni moins.
  const somme = (ids: readonly number[]) =>
    ids.reduce((total, id) => total + (pages[id].triangles as number), 0);
  assert.equal(drawnTriangles, somme(drawablePageIds!));
});

test('la part en mélange est prise sur le même ensemble que le total', () => {
  const { pages, packed, uni } = scene(1);
  const releve = evaluateDagSelectionKernel(packed, uni);
  const dessinables = releve.drawablePageIds!;
  const attendu = dessinables
    .filter((id) => pages[id].transparent)
    .reduce((total, id) => total + (pages[id].triangles as number), 0);
  assert.ok(attendu > 0, 'la scène doit porter des grappes en mélange');
  assert.equal(releve.transparentTriangles, attendu);
  assert.ok(releve.transparentTriangles! < releve.selectedTriangles!, 'et pas toutes');
});

test('la carte et la somme processeur donnent les mêmes totaux quand rien ne manque au processeur', () => {
  const recs = catalogue(scene(1).pages);
  // Toutes les pages ont leur ligne et leurs octets : le trou du processeur est vide, et sa
  // définition rejoint alors celle de la carte — la coupe dessinable entière.
  const offsets = new Int32Array(recs.length).fill(0);
  const drawnDelta = createCutDelta(recs);
  const counts = createCutCounts(recs, offsets, drawnDelta);
  for (const seuil of [0.25, 0.5, 1, 2]) {
    const { packed, uni } = scene(seuil);
    const releve = evaluateDagSelectionKernel(packed, uni);
    drawnDelta.apply(releve.drawablePageIds!);
    const totaux = counts.apply();
    assert.equal(totaux.selectedTriangles, releve.selectedTriangles, `seuil ${seuil} : coupe`);
    assert.equal(totaux.drawnTriangles, releve.drawnTriangles, `seuil ${seuil} : dessin`);
    assert.equal(totaux.uncoveredTriangles, releve.uncoveredTriangles, `seuil ${seuil} : trou`);
    assert.equal(
      totaux.transparentTriangles,
      releve.transparentTriangles,
      `seuil ${seuil} : mélange`,
    );
  }
});
