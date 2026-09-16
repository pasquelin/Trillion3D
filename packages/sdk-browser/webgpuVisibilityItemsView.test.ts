// GEO-01 : la tenue des fiches de visibilité était indexée sur la seule table de lignes et sur la
// partition occulteurs/testés. Une caméra qui bougeait sans changer cette partition rendait donc au
// test Hi-Z les bornes PROJETÉES de l'image précédente — des rectangles d'écran d'une autre vue —
// et des surfaces visibles pouvaient être rejetées à tort. Les bornes testées dépendent de la vue,
// pas seulement de la table : ces tests le tiennent.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { DRAW_ITEM_U32 } from './gpuDraw.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { bumpView, createFrameRevisions } from './frameRevisions.ts';
import { createProjectionHold } from './hizProjectionHold.ts';
import { buildWebgpuVisibilityItems, createVisibilityItemsHold } from './webgpuVisibilityItems.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un moteur à `n` lignes dont un tiers est dans la moitié testée, table et partition figées. */
function runtime(n: number) {
  const material = new THREE.MeshBasicMaterial();
  const packedRecs: PageRec[] = [];
  for (let i = 0; i < n; i++)
    packedRecs.push({
      array: Uint32Array.of(0, 1, 2),
      depthLayer: i % 2,
      material,
      matrix: new THREE.Matrix4(),
    } as unknown as PageRec);
  const rowWords = PAGE_INFO_STRIDE / 4;
  const pageTableInts = new Uint32Array(Math.max(1, n) * rowWords);
  for (let i = 0; i < n; i++) pageTableInts[i * rowWords + ROW_INDEX_WORDS] = 3;
  const layout = {
    rows: {
      packedCount: n,
      packedRecs,
      packedPageIndex: Int32Array.from({ length: n }, (_, i) => i),
      pageTableInts,
      tableEpoch: 1,
      rowsEpoch: 1,
      dirtyFrom: 1,
      dirtyTo: -1,
    },
    hizRest: Uint8Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 1 : 0)),
    drawItemWords: new Uint32Array(Math.max(1, n) * DRAW_ITEM_U32),
    binInstances: new Uint32Array(4096),
    drawRestBits: new Uint32Array(Math.ceil(Math.max(1, n) / 32)),
    hizTestedBounds: new Float64Array(Math.max(1, n) * HIZ_BOUNDS_VALUES),
    hizBounds: Float64Array.from({ length: Math.max(1, n) * HIZ_BOUNDS_VALUES }, (_, i) => i + 0.5),
    hizTestedRows: new Uint32Array(Math.max(1, n)),
    hizTestedTriangles: new Uint32Array(Math.max(1, n)),
    itemsHold: createVisibilityItemsHold(),
    hizProjection: createProjectionHold(Math.max(1, n)),
  };
  const rt = {
    layout,
    vis: { drawLayerSlots: 3 },
    timing: { lastItemsMs: 0 },
    run: { revisions: createFrameRevisions() },
  } as unknown as WebgpuPagesRuntime;
  return { rt, layout };
}

/** Une nouvelle projection : mêmes pages, même partition, d'autres rectangles d'écran. */
function reprojette(layout: ReturnType<typeof runtime>['layout']) {
  for (let i = 0; i < layout.hizBounds.length; i++) layout.hizBounds[i] += 100;
}

test('vue et table immobiles : la tenue rend les mêmes bornes sans refaire le travail', () => {
  const { rt, layout } = runtime(6);
  buildWebgpuVisibilityItems(rt, true, true, 1);
  const bornes = layout.hizTestedBounds.slice();
  buildWebgpuVisibilityItems(rt, true, false, 1);
  assert.equal(rt.timing.lastItemsMs, 0, 'la boucle a tourné pour rien');
  assert.deepEqual(layout.hizTestedBounds, bornes, 'les bornes tenues décrivent encore l’image');
});

test('caméra déplacée, partition identique : les bornes testées sont reprojetées', () => {
  const { rt, layout } = runtime(6);
  const camera = new THREE.PerspectiveCamera();
  layout.hizProjection.reframe(camera, 800, 600, layout.rows.tableEpoch);
  buildWebgpuVisibilityItems(rt, true, true, 1);
  const anciennes = layout.hizTestedBounds.slice();
  reprojette(layout);
  camera.position.set(3, 1, -2);
  layout.hizProjection.reframe(camera, 800, 600, layout.rows.tableEpoch);
  buildWebgpuVisibilityItems(rt, true, false, 1);
  const tenues = layout.hizTestedBounds.slice();
  assert.notDeepEqual(tenues, anciennes, 'bornes de la caméra précédente envoyées au test Hi-Z');
  // Au bit près ce que la boucle complète aurait écrit.
  layout.itemsHold.armed = false;
  buildWebgpuVisibilityItems(rt, true, false, 1);
  assert.deepEqual(tenues, layout.hizTestedBounds, 'bornes reprojetées');
});

test('révision de vue changée sans reprojection : les bornes testées sont recopiées', () => {
  const { rt, layout } = runtime(6);
  buildWebgpuVisibilityItems(rt, true, true, 1);
  reprojette(layout);
  bumpView(rt.run.revisions);
  buildWebgpuVisibilityItems(rt, true, false, 1);
  assert.equal(layout.hizTestedBounds[0], layout.hizBounds[0], 'borne de la vue précédente');
});

test('les fiches et les comptes ne sont pas réécrits quand seule la vue a bougé', () => {
  const { rt, layout } = runtime(9);
  const avant = buildWebgpuVisibilityItems(rt, true, true, 1);
  const fiches = layout.drawItemWords.slice(),
    bacs = layout.binInstances.slice(),
    restes = layout.drawRestBits.slice();
  const occulteurs = avant.occluderVertices,
    testes = avant.restVertices,
    comptees = avant.testedCount;
  reprojette(layout);
  bumpView(rt.run.revisions);
  const apres = buildWebgpuVisibilityItems(rt, true, false, 1);
  assert.deepEqual(layout.drawItemWords, fiches, 'les fiches ne dépendent que de la table');
  assert.deepEqual(layout.binInstances, bacs, 'les compteurs par bac ne dépendent que de la table');
  assert.deepEqual(layout.drawRestBits, restes, 'les bits de moitié testée non plus');
  assert.equal(apres.occluderVertices, occulteurs);
  assert.equal(apres.restVertices, testes);
  assert.equal(apres.testedCount, comptees, 'la moitié testée garde son ordre et sa taille');
});
