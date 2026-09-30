// CPU-16: `uploadDirtyRows` sends one `writeBuffer` per maximal run of contiguous dirty rows —
// the coalescing #431 delivered, proved here against develop's per-row upload on random marks and
// the edge cases: the table ends byte-identical, and the writes are exactly the runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirtyRows } from '../../row/dirty.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { fakeDevice, replayWrites } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import { HOSTILE_FLOATS } from '../../../../../../tests/kit/assert/hostile.ts';
import { seeded } from '../../../host/world/randomTree.fixture.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { uploadDirtyRows } from './dirtyRows.ts';

const ROWS = 64,
  ROW_FLOATS = PAGE_INFO_STRIDE / 4;

/** A table of `ROWS` rows, its dirty marks, and the runtime face `uploadDirtyRows` reads. */
function table(values: number[]) {
  const { device, writes } = fakeDevice();
  const dirty = createDirtyRows(ROWS);
  const floats = Float32Array.from(
    { length: ROWS * ROW_FLOATS },
    (_, i) => values[i % values.length],
  );
  const pageTable = device.createBuffer({ size: floats.byteLength, usage: 0 });
  const rows = {
    pageTableFloats: floats,
    dirtyMarks: dirty.marks,
    clearDirty: dirty.clear,
    get dirtyFrom() {
      return dirty.span.from;
    },
    get dirtyTo() {
      return dirty.span.to;
    },
  };
  const rt = {
    layout: { rows },
    vis: { pageTable },
    gpu: { device },
    timing: { encodeCounts: { rowsUploaded: 0 } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, dirty, floats, writes, pageTable };
}

/** The rows `marked` sent as develop's reference would: each row on its own. */
function rowByRow(floats: Float32Array, marked: number[]) {
  const bytes = new Uint8Array(floats.byteLength),
    source = new Uint8Array(floats.buffer);
  for (const row of marked) {
    const at = row * PAGE_INFO_STRIDE;
    bytes.set(source.subarray(at, at + PAGE_INFO_STRIDE), at);
  }
  return bytes;
}

/** The maximal runs of `marked`, `from-to` each. */
function runsOf(marked: number[]) {
  const runs: string[] = [];
  for (let k = 0; k < marked.length;) {
    let end = k;
    while (end + 1 < marked.length && marked[end + 1] === marked[end] + 1) end++;
    runs.push(`${marked[k]}-${marked[end]}`);
    k = end + 1;
  }
  return runs;
}

function check(marked: number[], values: number[]) {
  const { rt, dirty, floats, writes, pageTable } = table(values);
  for (const row of marked) dirty.mark(row);
  uploadDirtyRows(rt);
  const sent = writes.filter((w) => w.buffer === pageTable);
  const unique = [...new Set(marked)].sort((a, b) => a - b);
  const runs = sent.map(
    (w) => `${w.offset / PAGE_INFO_STRIDE}-${(w.offset + w.size!) / PAGE_INFO_STRIDE - 1}`,
  );
  assert.deepEqual(runs, runsOf(unique), 'one write per maximal run of contiguous rows');
  const bytes = new ArrayBuffer(floats.byteLength);
  replayWrites(bytes, sent);
  assert.deepEqual(new Uint8Array(bytes), rowByRow(floats, unique), 'the rows develop sends');
  assert.equal(rt.timing.encodeCounts.rowsUploaded, unique.length);
  assert.equal(dirty.span.to, -1, 'the marks cleared');
  assert.ok(dirty.marks.every((m) => m === 0));
}

test('contiguous dirty rows go up as one write per run, byte-identical to row by row', () => {
  const draw = seeded(1604);
  for (let round = 0; round < 200; round++) {
    const density = draw();
    const marked = Array.from({ length: ROWS }, (_, row) => row).filter(() => draw() < density);
    const values = Array.from({ length: 7 }, () =>
      draw() < 0.5
        ? HOSTILE_FLOATS[Math.floor(draw() * HOSTILE_FLOATS.length)]
        : draw() * 1e6 - 5e5,
    );
    check(marked, values);
  }
});

test('edge cases: no row, one row at each end, every row, every other row, a row marked twice', () => {
  const values = [...HOSTILE_FLOATS, 3.5e38, -3.5e38];
  check([], values);
  check([0], values);
  check([ROWS - 1], values);
  check(
    Array.from({ length: ROWS }, (_, row) => row),
    values,
  );
  check(
    Array.from({ length: ROWS / 2 }, (_, k) => 2 * k),
    values,
  );
  check([5, 5, 6], values);
});
