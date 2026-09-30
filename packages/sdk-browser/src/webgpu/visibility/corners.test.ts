// A moved model forgets and sends its own rows, not the terrain rows between them (#428). The
// table used to keep one dirty interval: a model whose rows sit at both ends of the table dropped
// the occlusion history of every row in between and sent them all again, each image it moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadRowCorners, createCornerUploadHold } from './corners.ts';
import { createWebgpuRowState } from '../row/state.ts';
import { CORNER_VALUES } from '../../gpu/partition/contract.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { PageRec } from '../../page/selection/types.ts';
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
        placementIndex: 0,
        min: [0, 0, 0],
        max: [1, 1, 1],
      }) as unknown as PageRec,
  );
  // One world for every row, the model's root's: its rows are those it moves. The model's pages
  // are packed 0..5 (#1235) and their rows are the scattered MODEL_ROWS.
  const model = {
    world,
    pages: MODEL_ROWS.map((row) => pages[row]),
    windingEpoch: 1,
    packedBase: 0,
  };
  const rows = createWebgpuRowState(pages, ROWS);
  rows.pageTableFloats = new Float32Array((ROWS * PAGE_INFO_STRIDE) / 4);
  for (let row = 0; row < ROWS; row++) {
    rows.rowOfPage[row] = row;
    rows.packedPageIndex[row] = row;
  }
  MODEL_ROWS.forEach((row, packed) => {
    rows.rowOfPage[packed] = row;
    rows.packedPageIndex[row] = packed;
  });
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
      selectionRoots: [model],
      // Every packed rank names the one placement (#1235).
      placement: {
        baseOfRoot: Int32Array.of(0),
        rootOfPacked: Int32Array.from({ length: ROWS }, () => 0),
      },
    },
    run: { noOccluderHistory: false, temporalHizState: {} },
    blendState: { occlusionEpoch: 1 },
    lights: { spheres: { buffer: sphereBuffer, packed: new Float32Array(ROWS * 4), rows: ROWS } },
    timing: { encodeCounts: { rowsUploaded: 0 } },
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
