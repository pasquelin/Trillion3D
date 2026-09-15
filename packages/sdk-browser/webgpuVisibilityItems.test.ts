// Lot F, F7 : `buildWebgpuVisibilityItems` (webgpuVisibilityItems.ts) lit l'enregistrement d'une
// ligne (`packedRecs[i]`) une fois par item au lieu de trois fois, et hisse `drawLayerSlots - 1` hors
// de la boucle. Aucune valeur ne change : c'est une pure réduction de lectures. L'oracle est
// l'implémentation d'avant le lot F, recopiée telle quelle dans `oracles/f-transparents.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { DRAW_ITEM_U32 } from './gpuDraw.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { buildWebgpuVisibilityItems } from './webgpuVisibilityItems.ts';
import { referenceBuildItems } from './bench/oracles/f-transparents.mjs';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un runtime minimal, à `n` lignes, dont chacune porte une couche coplanaire et une visibilité. */
function runtime(n: number, drawLayerSlots: number) {
  const material = new THREE.MeshBasicMaterial();
  const packedRecs: PageRec[] = [];
  for (let i = 0; i < n; i++)
    packedRecs.push({
      array: Uint32Array.of(0, 1, 2, 3, 4, 5).subarray(0, 3 + (i % 2) * 3),
      depthLayer: i % (drawLayerSlots + 2), // dépasse volontairement drawLayerSlots - 1
      material,
      matrix: new THREE.Matrix4(),
    } as unknown as PageRec);
  // La ligne du tableau de pages porte le compte d'indices que la carte dessine : `writePageRow`
  // l'y écrit à chaque fois qu'elle pose la ligne, et c'est ce mot que les fiches relisent.
  const rowWords = PAGE_INFO_STRIDE / 4;
  const pageTableInts = new Uint32Array(Math.max(1, n) * rowWords);
  for (let i = 0; i < n; i++)
    pageTableInts[i * rowWords + ROW_INDEX_WORDS] = packedRecs[i].array!.length;
  const layout = {
    rows: {
      packedCount: n,
      packedRecs,
      packedPageIndex: Int32Array.from({ length: n }, (_, i) => i),
      pageTableInts,
    },
    hizRest: Uint8Array.from({ length: n }, (_, i) => i % 3 === 0), // un tiers « rest »
    drawItemWords: new Uint32Array(Math.max(1, n) * DRAW_ITEM_U32),
    binInstances: new Uint32Array(4096),
    drawRestBits: new Uint32Array(Math.ceil(Math.max(1, n) / 32)),
    hizTestedBounds: new Float64Array(Math.max(1, n) * HIZ_BOUNDS_VALUES),
    hizBounds: Float64Array.from({ length: Math.max(1, n) * HIZ_BOUNDS_VALUES }, (_, i) => i + 0.5),
    hizTestedRows: new Uint32Array(Math.max(1, n)),
    hizTestedTriangles: new Uint32Array(Math.max(1, n)),
  };
  const rt = {
    layout,
    vis: { drawLayerSlots },
    timing: { lastItemsMs: 0 },
  } as unknown as WebgpuPagesRuntime;
  return { rt, layout };
}

function copieLayout(layout: ReturnType<typeof runtime>['layout']) {
  return {
    rows: layout.rows,
    hizRest: layout.hizRest.slice(),
    drawItemWords: layout.drawItemWords.slice(),
    binInstances: layout.binInstances.slice(),
    drawRestBits: layout.drawRestBits.slice(),
    hizTestedBounds: layout.hizTestedBounds.slice(),
    hizBounds: layout.hizBounds.slice(),
    hizTestedRows: layout.hizTestedRows.slice(),
    hizTestedTriangles: layout.hizTestedTriangles.slice(),
  };
}

function memeSortie(a: ReturnType<typeof runtime>, twoPass: boolean, itemsDirty: boolean) {
  const copie = copieLayout(a.layout);
  const attendu = referenceBuildItems({ layout: copie, vis: a.rt.vis }, twoPass, itemsDirty);
  const obtenu = buildWebgpuVisibilityItems(a.rt, twoPass, itemsDirty);
  assert.deepEqual(obtenu, attendu, 'occluderVertices / restVertices / testedCount');
  assert.deepEqual(a.layout.drawItemWords, copie.drawItemWords, 'drawItemWords');
  assert.deepEqual(a.layout.binInstances, copie.binInstances, 'binInstances');
  assert.deepEqual(a.layout.drawRestBits, copie.drawRestBits, 'drawRestBits');
  assert.deepEqual(a.layout.hizTestedBounds, copie.hizTestedBounds, 'hizTestedBounds');
  assert.deepEqual(a.layout.hizTestedRows, copie.hizTestedRows, 'hizTestedRows');
  assert.deepEqual(a.layout.hizTestedTriangles, copie.hizTestedTriangles, 'hizTestedTriangles');
}

test('aucune ligne : les compteurs restent à zéro des deux côtés', () => {
  const a = runtime(0, 3);
  memeSortie(a, true, true);
});

test('une seule ligne, occluder pur (rest = 0)', () => {
  const a = runtime(1, 3);
  a.layout.hizRest[0] = 0;
  memeSortie(a, false, true);
});

test('items non « dirty » : les mots ne sont pas réécrits, seuls les compteurs se recalculent', () => {
  const a = runtime(5, 3);
  // Une première passe pose des mots ; la seconde, non dirty, doit relire ces mots tels quels.
  buildWebgpuVisibilityItems(a.rt, true, true);
  const motsAvant = a.layout.drawItemWords.slice();
  memeSortie(a, true, false);
  assert.deepEqual(a.layout.drawItemWords, motsAvant, 'les mots d’item ne bougent pas');
});

test('depthLayer au-delà de drawLayerSlots - 1 se pince à la dernière couche, comme la référence', () => {
  const a = runtime(6, 2); // drawLayerSlots = 2 : seule la couche 0 est valide sans pincement
  memeSortie(a, true, true);
  for (let i = 0; i < 6; i++)
    assert.ok(a.layout.drawItemWords[i * DRAW_ITEM_U32 + 3] <= 1, `ligne ${i} hors bornes`);
});

test('two-pass avec des lignes « rest » copie les mêmes bornes Hi-Z testées, dans le même ordre', () => {
  const a = runtime(10, 4);
  memeSortie(a, true, true);
});

test('grand nombre de lignes, dirty et non dirty, deux passes : équivalence bit à bit systématique', () => {
  for (const [n, slots, twoPass, dirty] of [
    [128, 5, true, true],
    [128, 5, true, false],
    [128, 1, false, true],
    [97, 3, true, true],
  ] as const) {
    const a = runtime(n, slots);
    memeSortie(a, twoPass, dirty);
  }
});

test('le compte de sommets est celui de la ligne du tableau de pages, pas celui de l’objet', () => {
  const a = runtime(3, 3);
  const rowWords = PAGE_INFO_STRIDE / 4;
  // La ligne dit six indices là où l'objet en porte trois : la fiche suit la ligne, qui est ce que
  // la carte dessine. Les deux ne divergent que si une ligne a été posée sans être réécrite.
  a.layout.rows.pageTableInts[0 * rowWords + ROW_INDEX_WORDS] = 6;
  a.layout.hizRest[0] = 0;
  const avant = buildWebgpuVisibilityItems(a.rt, true, true);
  a.layout.rows.pageTableInts[0 * rowWords + ROW_INDEX_WORDS] = 9;
  const apres = buildWebgpuVisibilityItems(a.rt, true, true);
  assert.equal(apres.occluderVertices - avant.occluderVertices, 3);
});
