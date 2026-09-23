// Step A: draw-row words are no longer rebuilt per image. They follow the row table — a page that
// arrives, leaves or changes rank — and send the GPU only the contiguous range it has not yet
// received.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DRAW_ITEM_U32 } from '../../gpu/draw/draw.ts';
import type { GpuDraw } from '../../gpu/draw/draw.ts';
import { clearDrawItemWords, createDrawItemWordsHold, refreshDrawItemWords } from './itemWords.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { pageRecFixture } from '../../../../../bench/perf/browser/support/pageRecFixture.ts';
import { surfaceOf } from '../../page/surface.ts';

/** A minimal runtime of `n` rows: each carries a coplanar layer and a page index. */
function runtime(n: number, drawLayerSlots: number) {
  const material = new THREE.MeshBasicMaterial();
  const packedRecs: PageRec[] = [];
  for (let i = 0; i < n; i++)
    packedRecs.push(
      pageRecFixture({
        depthLayer: i % 3,
        material: surfaceOf(material),
        matrix: new THREE.Matrix4(),
      }),
    );
  const layout = {
    rows: {
      packedCount: n,
      packedRecs,
      packedPageIndex: Int32Array.from({ length: n }, (_, i) => 100 + i),
      dirtyFrom: 0,
      dirtyTo: n - 1,
    },
    drawItemWords: new Uint32Array(Math.max(1, n) * DRAW_ITEM_U32),
    itemWordsHold: createDrawItemWordsHold(drawLayerSlots),
  };
  const rt = { layout, vis: { drawLayerSlots } } as unknown as WebgpuPagesRuntime;
  return { rt, layout };
}

const cible = {} as GpuDraw;

test('the first image writes the four words of each row and declares them all to send', () => {
  const a = runtime(4, 3);
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.deepEqual([hold.from, hold.to], [0, 3]);
  for (let row = 0; row < 4; row++) {
    const word = row * DRAW_ITEM_U32;
    assert.equal(a.layout.drawItemWords[word], row, 'the row word is the rank');
    assert.equal(a.layout.drawItemWords[word + 2], 100 + row, 'the catalogue page index');
    assert.equal(a.layout.drawItemWords[word + 3], Math.min(row % 3, 2), 'the coplanar layer');
  }
});

test('only the dirty range is rewritten: a row outside the range keeps its words', () => {
  const a = runtime(8, 3);
  refreshDrawItemWords(a.rt, 2, cible);
  clearDrawItemWords(a.layout.itemWordsHold);
  // Row 5 changes occupant, and it alone: the table declares only that one.
  a.layout.rows.packedPageIndex[5] = 999;
  a.layout.rows.packedPageIndex[1] = 888;
  a.layout.rows.dirtyFrom = 5;
  a.layout.rows.dirtyTo = 5;
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.deepEqual([hold.from, hold.to], [5, 5], "the range to send is the table's");
  assert.equal(a.layout.drawItemWords[5 * DRAW_ITEM_U32 + 2], 999, 'the dirty row is rewritten');
  assert.equal(a.layout.drawItemWords[1 * DRAW_ITEM_U32 + 2], 101, 'the clean row is not');
});

test('the range to send widens until an image has sent it', () => {
  const a = runtime(8, 3);
  refreshDrawItemWords(a.rt, 2, cible);
  clearDrawItemWords(a.layout.itemWordsHold);
  a.layout.rows.dirtyFrom = 6;
  a.layout.rows.dirtyTo = 6;
  refreshDrawItemWords(a.rt, 2, cible);
  a.layout.rows.dirtyFrom = 2;
  a.layout.rows.dirtyTo = 2;
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.deepEqual([hold.from, hold.to], [2, 6], 'both rows fit in a single range');
  clearDrawItemWords(hold);
  assert.ok(hold.to < hold.from, 'once sent, the range is empty');
});

test('a new layer ceiling, or a fresh compaction buffer, asks for the whole table again', () => {
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
    assert.deepEqual([hold.from, hold.to], [0, 5], 'the whole table leaves, with no dirty row');
  }
});

test("a lower layer ceiling pinches each row's layer, like indirect draw", () => {
  const a = runtime(6, 3);
  refreshDrawItemWords(a.rt, 1, cible);
  for (let row = 0; row < 6; row++)
    assert.ok(a.layout.drawItemWords[row * DRAW_ITEM_U32 + 3] <= 1, `ligne ${row} hors bornes`);
});

test('no row: nothing is written and nothing is to send', () => {
  const a = runtime(0, 3);
  const hold = refreshDrawItemWords(a.rt, 2, cible);
  assert.ok(hold.to < hold.from, 'no range');
});
