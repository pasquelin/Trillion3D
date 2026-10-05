// A growth of the float pool moves the deformation block after the wider vertices (`wholePool.ts`,
// `SessionDeformation.place`): every row that reads a record or a float-pool block, and every
// transparent span that reads a block, is pointed at the new place; a slot's tail is left as is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deformOutputWord, followPooledBlocks } from './slotLayout.ts';
import {
  PAGE_DEFORM_OUTPUT_WORD,
  PAGE_DEFORM_WORD,
  PAGE_INFO_STRIDE,
} from '../visibility/types.ts';
import type { HostAttributes } from '../host/resources.ts';
import type { PageRec } from '../page/selection/selection.ts';

/** Three rows — a float-pool block, a slot's tail, the block again — over two placements. */
function rig() {
  const block = { from: 100, count: 9, pool: { attributes: {} as HostAttributes } },
    tail = { from: 12, count: 3 };
  const recs = [block, tail, block].map((deformationOutput) => ({ deformationOutput }) as PageRec);
  const words = PAGE_INFO_STRIDE / 4,
    ints = new Uint32Array(3 * words),
    marked: number[] = [];
  ints[words + PAGE_DEFORM_OUTPUT_WORD] = 77;
  const rows = {
    pageTableInts: ints,
    packedRecs: recs,
    packedPageIndex: Int32Array.from([0, 1, 2]),
    markRowWords: (r: number) => marked.push(r),
  };
  const spans = new Uint32Array(12),
    dirtySpans = new Set<number>();
  spans.set([5, 6, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0]); // entry 0 drawn, entry 2 holds no corner
  // Placement 1 (the tail's page) holds a record at float 40 of the block, which starts at `base`.
  const deformation = {
    base: 500,
    rowWord(rank: number) {
      return rank === 1 ? this.base + 40 : 0;
    },
  };
  const rt = {
    layout: {
      rows,
      recordOf: (page: number) => recs[page],
      placement: { rootOfPacked: Int32Array.from([0, 1, 0]) },
    },
    blendState: { table: { entryOfPage: Int32Array.from([0, 1, 2]), spans }, dirtySpans },
    vis: { deformation },
  } as unknown as Parameters<typeof followPooledBlocks>[0];
  ints[words + PAGE_DEFORM_WORD] = deformation.rowWord(1);
  return { block, ints, words, marked, spans, dirtySpans, deformation, rt };
}

test('the rows and spans of a moved float-pool block follow it; a tail stays', () => {
  const { block, ints, words, marked, spans, dirtySpans, rt } = rig();
  block.from = 4000;
  followPooledBlocks(rt);
  const moved = deformOutputWord(block, 0);
  assert.deepEqual(marked, [0, 2]);
  assert.equal(ints[PAGE_DEFORM_OUTPUT_WORD], moved);
  assert.equal(ints[2 * words + PAGE_DEFORM_OUTPUT_WORD], moved);
  assert.equal(ints[words + PAGE_DEFORM_OUTPUT_WORD], 77, "a tail's word is its slot's");
  assert.deepEqual([spans[2], spans[10], [...dirtySpans]], [moved, 0, [0]]);
});

test("a row's record word follows the moved records; a row with none, or unmoved, is not written", () => {
  const { ints, words, marked, deformation, rt } = rig();
  followPooledBlocks(rt);
  assert.deepEqual(marked, [0, 2], 'records in place: only the blocks are written again');
  marked.length = 0;
  deformation.base = 9000;
  followPooledBlocks(rt);
  assert.equal(ints[words + PAGE_DEFORM_WORD], 9040, 'the record read at its new place');
  assert.deepEqual([ints[PAGE_DEFORM_WORD], ints[2 * words + PAGE_DEFORM_WORD]], [0, 0]);
  assert.deepEqual(marked, [0, 1, 2]);
});
