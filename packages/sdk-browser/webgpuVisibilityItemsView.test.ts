// GEO-01 : les bornes envoyées au test Hi-Z sont des rectangles d'ÉCRAN — elles dépendent du point
// de vue de l'image. La tenue des fiches de visibilité les gardait pourtant sur la seule table de
// lignes et la partition occulteurs/testés : une caméra qui bougeait sans changer cette partition
// faisait tester à l'image les rectangles de la caméra précédente, et des surfaces visibles
// pouvaient être rejetées à tort. La signature que la partition rend porte désormais l'âge des
// rectangles, qui change dès que la vue, le viewport ou l'âge de la table les retire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionWebgpuVisibility } from './webgpuVisibilityPartition.ts';
import { createWebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { cameraMoteur } from './cameraFixture.ts';

/** Deux pages dont l'historique ne partage que la première : la partition rend deux passes, donc
 *  une moitié testée, donc des bornes projetées à envoyer au noyau. */
function moteur() {
  const fixture = quadScene();
  const rt = createWebgpuPagesRuntime({ ...fixture, viewport: [32, 32] });
  rt.layout.rows.packedCount = 2;
  rt.layout.rows.packedPageIndex.set([0, 1]);
  rt.layout.urlIndexOfPage.set([0, 1]);
  rt.layout.drawnOccluderUrls[0] = 1;
  rt.run.noOccluderHistory = false;
  rt.vis.gpuHiz = {} as NonNullable<typeof rt.vis.gpuHiz>;
  rt.vis.visHizRestBack = {} as GPURenderPipeline;
  return {
    rt,
    dispose: () => (fixture.geometry.dispose(), fixture.material.dispose()),
  };
}

test('vue immobile : la signature de partition ne bouge pas d’une image à l’autre', () => {
  const { rt, dispose } = moteur();
  const vue = camera();
  const premiere = partitionWebgpuVisibility(rt, cameraMoteur(vue));
  assert.equal(premiere.twoPass, true, 'sans moitié testée, il n’y a aucune borne à tenir');
  for (let i = 0; i < 3; i++)
    assert.equal(
      partitionWebgpuVisibility(rt, cameraMoteur(vue)).restSignature,
      premiere.restSignature,
      'la signature change sans que rien ne bouge : la tenue ne s’appliquerait jamais',
    );
  dispose();
});

test('caméra déplacée, partition des pages identique : la signature change avec les rectangles', () => {
  const { rt, dispose } = moteur();
  const vue = camera();
  const avant = partitionWebgpuVisibility(rt, cameraMoteur(vue)).restSignature;
  const partitionAvant = Array.from(rt.layout.hizRest.subarray(0, 2));
  vue.position.set(1.5, 0.5, vue.position.z);
  vue.updateMatrixWorld();
  const apres = partitionWebgpuVisibility(rt, cameraMoteur(vue));
  assert.deepEqual(
    Array.from(rt.layout.hizRest.subarray(0, 2)),
    partitionAvant,
    'la partition des pages a changé : le cas n’est plus celui qu’on veut tenir',
  );
  assert.notEqual(
    apres.restSignature,
    avant,
    'les bornes projetées de la caméra précédente auraient été tenues',
  );
  dispose();
});

test('cible redimensionnée, même caméra : la signature change aussi', () => {
  const { rt, dispose } = moteur();
  const vue = camera();
  const avant = partitionWebgpuVisibility(rt, cameraMoteur(vue)).restSignature;
  rt.gpu.targetSize[0] = 64;
  assert.notEqual(
    partitionWebgpuVisibility(rt, cameraMoteur(vue)).restSignature,
    avant,
    'un rectangle d’écran dépend de la cible autant que de la caméra',
  );
  dispose();
});

test('âge de table changé : la signature change, les boîtes ne décrivent plus les mêmes pages', () => {
  const { rt, dispose } = moteur();
  const vue = camera();
  const avant = partitionWebgpuVisibility(rt, cameraMoteur(vue)).restSignature;
  rt.layout.rows.tableEpoch++;
  assert.notEqual(partitionWebgpuVisibility(rt, cameraMoteur(vue)).restSignature, avant);
  dispose();
});
