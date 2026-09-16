// Étape A : les mots de fiche de dessin ne sont plus reconstruits par image. Ils suivent la table de
// lignes — une page qui arrive, qui part ou qui change de rang — et n'envoient à la carte que la
// plage contiguë qu'elle n'a pas encore reçue.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DRAW_ITEM_U32 } from './gpuDraw.ts';
import type { GpuDraw } from './gpuDraw.ts';
import {
  clearDrawItemWords,
  createDrawItemWordsHold,
  refreshDrawItemWords,
} from './webgpuVisibilityItemWords.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un runtime minimal de `n` lignes : chacune porte une couche coplanaire et un index de page. */
function runtime(n: number, drawLayerSlots: number) {
  const material = new THREE.MeshBasicMaterial();
  const packedRecs: PageRec[] = [];
  for (let i = 0; i < n; i++)
    packedRecs.push({ depthLayer: i % 3, material, matrix: new THREE.Matrix4() } as PageRec);
  const layout = {
    rows: {
      packedCount: n,
      packedRecs,
      packedPageIndex: Int32Array.from({ length: n }, (_, i) => 100 + i),
      dirtyFrom: 0,
      dirtyTo: n - 1,
    },
    drawItemWords: new Uint32Array(Math.max(1, n) * DRAW_ITEM_U32),
    itemWordsHold: createDrawItemWordsHold(),
  };
  const rt = { layout, vis: { drawLayerSlots } } as unknown as WebgpuPagesRuntime;
  return { rt, layout };
}

const cible = {} as GpuDraw;

test('la première image écrit les quatre mots de chaque ligne et les déclare tous à envoyer', () => {
  const a = runtime(4, 3);
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.deepEqual([hold.from, hold.to], [0, 3]);
  for (let row = 0; row < 4; row++) {
    const word = row * DRAW_ITEM_U32;
    assert.equal(a.layout.drawItemWords[word], row, 'le mot de ligne est le rang');
    assert.equal(a.layout.drawItemWords[word + 2], 100 + row, 'l’index de page du catalogue');
    assert.equal(a.layout.drawItemWords[word + 3], Math.min(row % 3, 2), 'la couche coplanaire');
  }
});

test('seule la plage sale est réécrite : une ligne hors plage garde ses mots', () => {
  const a = runtime(8, 3);
  refreshDrawItemWords(a.rt, 2, cible);
  clearDrawItemWords(a.layout.itemWordsHold);
  // La ligne 5 change d'occupant, et elle seule : la table ne déclare que celle-là.
  a.layout.rows.packedPageIndex[5] = 999;
  a.layout.rows.packedPageIndex[1] = 888;
  a.layout.rows.dirtyFrom = 5;
  a.layout.rows.dirtyTo = 5;
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.deepEqual([hold.from, hold.to], [5, 5], 'la plage à envoyer est celle de la table');
  assert.equal(a.layout.drawItemWords[5 * DRAW_ITEM_U32 + 2], 999, 'la ligne sale est réécrite');
  assert.equal(a.layout.drawItemWords[1 * DRAW_ITEM_U32 + 2], 101, 'la ligne propre ne l’est pas');
});

test('la plage à envoyer s’élargit tant qu’aucune image ne l’a envoyée', () => {
  const a = runtime(8, 3);
  refreshDrawItemWords(a.rt, 2, cible);
  clearDrawItemWords(a.layout.itemWordsHold);
  a.layout.rows.dirtyFrom = 6;
  a.layout.rows.dirtyTo = 6;
  refreshDrawItemWords(a.rt, 2, cible);
  a.layout.rows.dirtyFrom = 2;
  a.layout.rows.dirtyTo = 2;
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.deepEqual([hold.from, hold.to], [2, 6], 'les deux lignes tiennent dans une seule plage');
  clearDrawItemWords(hold);
  assert.ok(hold.to < hold.from, 'envoyée, la plage est vide');
});

test('un plafond de couches nouveau, ou un tampon de compaction neuf, redemande toute la table', () => {
  for (const [couches, tampon] of [
    [1, cible],
    [2, {} as GpuDraw],
  ] as const) {
    const a = runtime(6, 3);
    refreshDrawItemWords(a.rt, 2, cible);
    clearDrawItemWords(a.layout.itemWordsHold);
    a.layout.rows.dirtyFrom = 6;
    a.layout.rows.dirtyTo = -1;
    const hold = refreshDrawItemWords(a.rt, couches, tampon);
    assert.deepEqual([hold.from, hold.to], [0, 5], 'toute la table part, sans ligne sale');
  }
});

test('un plafond de couches plus bas pince la couche de chaque ligne, comme le dessin indirect', () => {
  const a = runtime(6, 3);
  refreshDrawItemWords(a.rt, 1, cible);
  for (let row = 0; row < 6; row++)
    assert.ok(a.layout.drawItemWords[row * DRAW_ITEM_U32 + 3] <= 1, `ligne ${row} hors bornes`);
});

test('aucune ligne : rien n’est écrit et rien n’est à envoyer', () => {
  const a = runtime(0, 3);
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.ok(hold.to < hold.from, 'aucune plage');
});
