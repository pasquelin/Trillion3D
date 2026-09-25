// A moved model forgets and sends its own rows, not the terrain rows between them (#428). The
// table used to keep one dirty interval: a model whose rows sit at both ends of the table dropped
// the occlusion history of every row in between and sent them all again, each image it moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadRowCorners, createCornerUploadHold } from './corners.ts';
import { uploadDirtyRows } from '../pages/render/encodeDraws.ts';
import { uploadClusterSpheres } from '../shadow/bounds.ts';
import { moveRootRows } from '../pages/render/movedRoot.ts';
import { createWebgpuRowState } from '../row/state.ts';
import { CORNER_VALUES } from '../../gpu/partition/contract.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const ROWS = 1000,
  MODEL_ROWS = [3, 4, 400, 401, 402, 997];

/** A table of `ROWS` drawn rows, the model's clusters scattered in it, every witness up to date. */
function scatteredScene() {
  const world = { elements: new Float64Array(16) };
  const pages = Array.from(
    { length: ROWS },
    (_, i) =>
      ({
        url: `p${i}`,
        matrix: world,
        windingEpoch: 1,
        min: [0, 0, 0],
        max: [1, 1, 1],
      }) as unknown as PageRec,
  );
  const model = { world, pages: MODEL_ROWS.map((row) => pages[row]) } as ClusterRoot<PageRec>;
  const rows = createWebgpuRowState(pages, ROWS);
  rows.pageTableFloats = new Float32Array((ROWS * PAGE_INFO_STRIDE) / 4);
  for (let row = 0; row < ROWS; row++) {
    rows.rowOfPage[row] = row;
    rows.packedPageIndex[row] = row;
  }
  rows.packedCount = ROWS;
  const cornerHold = createCornerUploadHold();
  cornerHold.epoch = rows.tableEpoch;
  cornerHold.count = ROWS;
  const forgotten: number[] = [],
    corners: number[] = [];
  const sphereBuffer = {} as GPUBuffer;
  const { device, writes } = fakeDevice();
  // Rows each write sent, to the sphere buffer or to the page table.
  const sent = (toSpheres: boolean) =>
    writes
      .filter(({ buffer }) => (buffer === sphereBuffer) === toSpheres)
      .map(({ size }) => size! / (toSpheres ? 4 : PAGE_INFO_STRIDE));
  const spheres = () => sent(true),
    table = () => sent(false);
  const rt = {
    layout: {
      rows,
      drawSlots: ROWS,
      cornerPacked: new Float32Array(ROWS * CORNER_VALUES),
      cornerHold,
    },
    run: { noOccluderHistory: false, temporalHizState: {} },
    blendState: { occlusionEpoch: 1 },
    lights: { spheres: { buffer: sphereBuffer, packed: new Float32Array(ROWS * 4), rows: ROWS } },
    timing: { encodeCounts: { lignesTeleversees: 0 } },
    gpu: { device },
    vis: {
      pageTable: {},
      gpuPartition: {
        forgetRows: (from: number, to: number) => forgotten.push(to - from + 1),
        uploadCorners: (_p: unknown, from: number, to: number) => corners.push(to - from + 1),
      },
    },
  } as unknown as WebgpuPagesRuntime;
  const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
  return { rt, model, forgotten, corners, table, spheres, sum };
}

test('a model scattered across the table forgets and sends its own rows, run by run', () => {
  const { rt, model, forgotten, corners, table, spheres, sum } = scatteredScene();
  assert.equal(moveRootRows(rt, model), MODEL_ROWS.length);
  const { rows } = rt.layout;
  // The span still bounds the marks: first and last rows of the model.
  assert.deepEqual([rows.dirtyFrom, rows.dirtyTo], [3, 997]);
  uploadClusterSpheres(rt, rt.gpu.device!);
  uploadRowCorners(rt);
  uploadDirtyRows(rt);
  assert.deepEqual(forgotten, [2, 3, 1], 'three runs, 6 rows forgotten of the 995 spanned');
  assert.deepEqual(spheres(), [2, 3, 1], 'the same 6 shadow spheres sent');
  assert.deepEqual(corners, [2, 3, 1], 'the same 6 rows of corners sent');
  assert.deepEqual(table(), [2, 3, 1], 'the same 6 rows of the table sent');
  assert.equal(rt.timing.encodeCounts.lignesTeleversees, sum(table()));
  assert.equal(rows.dirtyTo, -1, 'every mark consumed');
  assert.equal(rows.dirtyMarks.indexOf(1), -1);
  // A still image: nothing marked, nothing forgotten, nothing sent.
  uploadRowCorners(rt);
  uploadDirtyRows(rt);
  assert.equal(sum(forgotten), 6);
  assert.equal(sum(table()), 6);
  assert.equal(rt.timing.encodeCounts.lignesTeleversees, 0);
});

test('a table that grew forgets the rows that entered; a new age sends every row once', () => {
  const { rt, forgotten, corners } = scatteredScene();
  const { rows, cornerHold } = rt.layout;
  cornerHold.count = ROWS - 10;
  rows.markRowDirty(5);
  rows.tableEpoch++;
  uploadRowCorners(rt);
  assert.deepEqual(forgotten, [1, 10], 'the dirty row, then the ten that entered');
  assert.deepEqual(corners, [ROWS], 'a stale witness sends the whole rank');
  assert.equal(cornerHold.count, ROWS);
});
