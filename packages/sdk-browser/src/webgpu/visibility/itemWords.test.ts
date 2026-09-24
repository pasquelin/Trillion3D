// Step A: draw-row words are no longer rebuilt per image. They follow the row table — a page that
// arrives, leaves or changes rank — and send the GPU only the rows it has not yet received, run by
// run.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DRAW_ITEM_U32 } from '../../gpu/draw/draw.ts';
import type { GpuDraw } from '../../gpu/draw/draw.ts';
import { createDrawItemWordsHold, refreshDrawItemWords, sendDrawItemWords } from './itemWords.ts';
import { createDirtyRows } from '../row/dirty.ts';
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
  const dirty = createDirtyRows(Math.max(1, n));
  const layout = {
    rows: {
      packedCount: n,
      packedRecs,
      packedPageIndex: Int32Array.from({ length: n }, (_, i) => 100 + i),
      dirtyMarks: dirty.marks,
      get dirtyFrom() {
        return dirty.span.from;
      },
      get dirtyTo() {
        return dirty.span.to;
      },
    },
    drawItemWords: new Uint32Array(Math.max(1, n) * DRAW_ITEM_U32),
    itemWordsHold: createDrawItemWordsHold(n),
  };
  const sent: Array<[number, number]> = [];
  const rt = {
    layout,
    vis: {
      drawLayerSlots,
      gpuDraw: { uploadItems: (_: unknown, from: number, to: number) => sent.push([from, to]) },
    },
    timing: { encodeCounts: { fichesTeleversees: 0 } },
  } as unknown as WebgpuPagesRuntime;
  /** The image's rows are read: the table's marks are consumed, the pending ones stay. */
  const image = (layerSlots: number, target: GpuDraw) => {
    const hold = refreshDrawItemWords(rt, layerSlots, target);
    dirty.clear();
    return hold;
  };
  return { rt, layout, dirty, sent, image };
}

const pendingSpan = (hold: { pending: { span: { from: number; to: number } } }) => [
  hold.pending.span.from,
  hold.pending.span.to,
];

const cible = {} as GpuDraw;

test('the first image writes the four words of each row and declares them all to send', () => {
  const a = runtime(4, 3);
  const hold = a.image(2, cible);
  assert.deepEqual(pendingSpan(hold), [0, 3]);
  for (let row = 0; row < 4; row++) {
    const word = row * DRAW_ITEM_U32;
    assert.equal(a.layout.drawItemWords[word], row, 'the row word is the rank');
    assert.equal(a.layout.drawItemWords[word + 2], 100 + row, 'the catalogue page index');
    assert.equal(a.layout.drawItemWords[word + 3], Math.min(row % 3, 2), 'the coplanar layer');
  }
});

test('only the dirty rows are rewritten: a row outside them keeps its words', () => {
  const a = runtime(8, 3);
  a.image(2, cible);
  sendDrawItemWords(a.rt);
  // Row 5 changes occupant, and it alone: the table declares only that one.
  a.layout.rows.packedPageIndex[5] = 999;
  a.layout.rows.packedPageIndex[1] = 888;
  a.dirty.mark(5);
  const hold = a.image(2, cible);
  assert.deepEqual(pendingSpan(hold), [5, 5], "the rows to send are the table's");
  assert.equal(a.layout.drawItemWords[5 * DRAW_ITEM_U32 + 2], 999, 'the dirty row is rewritten');
  assert.equal(a.layout.drawItemWords[1 * DRAW_ITEM_U32 + 2], 101, 'the clean row is not');
});

test('the rows to send accumulate until an image sends them, run by run', () => {
  const a = runtime(8, 3);
  a.image(2, cible);
  sendDrawItemWords(a.rt);
  a.sent.length = 0;
  a.rt.timing.encodeCounts.fichesTeleversees = 0;
  a.dirty.mark(6);
  a.image(2, cible);
  a.dirty.mark(2);
  const hold = a.image(2, cible);
  sendDrawItemWords(a.rt);
  assert.deepEqual(
    a.sent,
    [
      [2, 2],
      [6, 6],
    ],
    'two runs, none of the rows between them',
  );
  assert.equal(a.rt.timing.encodeCounts.fichesTeleversees, 2);
  assert.ok(hold.pending.span.to < hold.pending.span.from, 'once sent, nothing is pending');
});

test('a new layer ceiling, or a fresh compaction buffer, asks for the whole table again', () => {
  for (const [couches, tampon] of [
    [1, cible],
    [2, {} as GpuDraw],
  ] as const) {
    const a = runtime(6, 3);
    a.image(2, cible);
    sendDrawItemWords(a.rt);
    const hold = a.image(couches, tampon);
    assert.deepEqual(pendingSpan(hold), [0, 5], 'the whole table leaves, with no dirty row');
  }
});

test("a lower layer ceiling pinches each row's layer, like indirect draw", () => {
  const a = runtime(6, 3);
  a.image(1, cible);
  for (let row = 0; row < 6; row++)
    assert.ok(a.layout.drawItemWords[row * DRAW_ITEM_U32 + 3] <= 1, `ligne ${row} hors bornes`);
});

test('no row: nothing is written and nothing is to send', () => {
  const a = runtime(0, 3);
  const hold = a.image(2, cible);
  assert.ok(hold.pending.span.to < hold.pending.span.from, 'no row');
});
