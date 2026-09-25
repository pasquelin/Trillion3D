// #198: the fallback draw uploads the rows the table changed and clears their dirty marks. The draw
// records and projection corners the visibility pass keeps per row are refreshed from those same
// marks: a row whose occupant changed under the fallback must still reach the compaction and the
// partition once the pass comes back on the same targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAW_ITEM_U32 } from '../../../gpu/draw/draw.ts';
import { CORNER_VALUES } from '../../../gpu/partition/contract.ts';
import { packPageCorners } from '../../visibility/corners.ts';
import { visBin } from '../prepare/pipelineFor.ts';
import { renderWebgpuPages } from './render.ts';
import { flushWebgpuPages } from './flush.ts';
import { cameraAt, twoPlacesRuntime } from '../twoPlaces.fixture.ts';

type Runtime = Awaited<ReturnType<typeof twoPlacesRuntime>>['rt'];

/**
 * Draws both rows with the visibility pass, calls `watch` (which wraps the uploads it follows), then
 * draws one row under the fallback (visibility view removed) so row 0 changes occupant, and brings
 * the pass back on the same targets. Every loop is bounded by a few images.
 */
async function changeRowUnderFallback(watch: (rt: Runtime) => void, check: (rt: Runtime) => void) {
  const { rt, dispose } = await twoPlacesRuntime();
  const second = cameraAt(21, 5);
  try {
    const { rows } = rt.layout;
    assert.equal(rows.packedCount, 2, 'the wide view draws both rows');
    const { gpuDraw: draw, gpuPartition: partition, visView: view } = rt.vis;
    assert.ok(draw && partition && view, 'the visibility pass encodes with its compaction');
    watch(rt);
    const firstPage = rows.packedPageIndex[0];
    // The fallback draw: the second mesh alone, so row 0 changes occupant.
    rt.vis.visView = undefined;
    for (let frame = 0; frame < 4 && rt.layout.rows.packedCount !== 1; frame++) {
      renderWebgpuPages(rt, second);
      await flushWebgpuPages(rt);
    }
    assert.equal(rows.packedCount, 1, 'the narrow view draws one row');
    assert.notEqual(rows.packedPageIndex[0], firstPage, 'row 0 changed occupant');
    assert.equal(rt.vis.gpuDraw, draw, 'the compaction target is the same');
    assert.equal(rt.vis.gpuPartition, partition, 'the partition is the same');
    // The visibility pass comes back on the same targets; the view steps, or the previous image
    // would be held.
    rt.vis.visView = view;
    renderWebgpuPages(rt, cameraAt(21, 5.01));
    await flushWebgpuPages(rt);
    assert.equal(rows.packedCount, 1);
    check(rt);
  } finally {
    dispose();
  }
}

test('#198: a row changed under the fallback draw reaches the compaction', async () => {
  // What the compaction holds: the words each upload sends, row by row.
  let held = new Uint32Array(0);
  await changeRowUnderFallback(
    (rt) => {
      const draw = rt.vis.gpuDraw!,
        upload = draw.uploadItems.bind(draw);
      held = new Uint32Array(rt.layout.drawItemWords.length);
      draw.uploadItems = (items, from, to) => {
        held.set(
          items.subarray(from * DRAW_ITEM_U32, (to + 1) * DRAW_ITEM_U32),
          from * DRAW_ITEM_U32,
        );
        upload(items, from, to);
      };
    },
    ({ layout: { rows } }) => {
      assert.equal(held[2], rows.packedPageIndex[0], 'the compaction holds the row page index');
      assert.equal(
        held[1],
        visBin(rows.packedRecs[0]!),
        'the compaction holds the row pipeline bin',
      );
    },
  );
});

test('#198: a row changed under the fallback draw reaches the partition corners', async () => {
  // What the partition holds: the corners each upload sends, row by row.
  let held = new Float32Array(0);
  await changeRowUnderFallback(
    (rt) => {
      const partition = rt.vis.gpuPartition!,
        upload = partition.uploadCorners.bind(partition);
      held = new Float32Array(rt.layout.cornerPacked.length);
      partition.uploadCorners = (packed, from, to) => {
        held.set(
          packed.subarray(from * CORNER_VALUES, (to + 1) * CORNER_VALUES),
          from * CORNER_VALUES,
        );
        upload(packed, from, to);
      };
    },
    ({ layout: { rows } }) => {
      const expected = new Float32Array(CORNER_VALUES);
      packPageCorners(expected, 0, rows.packedRecs[0]!);
      assert.deepEqual(
        held.subarray(0, CORNER_VALUES),
        expected,
        'the partition holds row 0 corners',
      );
    },
  );
});
