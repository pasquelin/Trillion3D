// `growTables.ts` sizes a view's row table from what the cut asked (#1232), and a growing view grows
// the table in place. Its bounds compose three numbers the layout owns — the catalogue, the slot
// budget a pool holds, and what the device allows in one binding — so the test names the three ways a
// row asked can be held, and the one that bounds it for good.
//
// The tree had no test for this module: `boundTableRows` is tested in `../../row/tableRows.test.ts`,
// and `followCutRows` only runs inside a session. What nothing covered was the composition, which is
// where a row table is sized wrong — a table that holds every row asked is not the same as one that
// asks for more than a slot can carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tableRowsFor } from './growTables.ts';
import { pageTableRows } from '../../row/pageTableRows.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

const MIB = 1 << 20;
const DEVICE = { maxStorageBufferBindingSize: 128 * MIB, maxBufferSize: 256 * MIB };

/** The runtime `tableRowsFor` reads: a catalogue of `packedPages` pages, `opaquePageCount` of them
 *  opaque, the row table's own bound, and how many placements may share one slot. Nothing else of a
 *  session is touched. */
const runtime = (
  packedPages: number,
  opaquePageCount: number,
  viewRows: number,
  limits: typeof DEVICE | undefined,
  copies = 1,
) =>
  ({
    layout: {
      packedPages: new Array(packedPages),
      opaquePageCount,
      viewRows,
      copies: { max: copies },
    },
    context: { gpuDevice: limits ? { limits } : undefined },
  }) as unknown as WebgpuPagesRuntime;

const asked = (rt: ReturnType<typeof runtime>, slots: number) => tableRowsFor(rt, slots);

test('a cut within every bound keeps every row it asked, and says nothing was bounded', () => {
  const rows = asked(runtime(100, 90, 1000, DEVICE, 4), 32);
  assert.deepEqual(rows, { drawSlots: 90, blendSlots: 10, bounded: null });
});

test('a catalogue of nothing opaque still draws one row, never zero', () => {
  // A scene whose first page is transparent: the opaque count is zero, and a table of zero rows
  // would bind nothing and draw nothing.
  const rows = asked(runtime(10, 0, 1000, DEVICE), 32);
  assert.equal(rows.drawSlots, 1, 'the blend side may take the rest');
  assert.ok(rows.blendSlots >= 1);
});

test('a cut past the rows the view holds is held to them, not to the catalogue', () => {
  const rows = asked(runtime(5000, 4500, 100, DEVICE, 4), 32);
  assert.ok(rows.drawSlots <= 100, `the view holds 100 rows, asked ${rows.drawSlots}`);
});

test('a cut past what the slots carry is held to it: a slot may repeat, a table may not', () => {
  // `copies.max` placements share one slot, so the rows a pool can hold are `slots × copies`. A
  // catalogue of a million pages on one slot is a cut of one page drawn many times, not a table of a
  // million rows: that is what the residency mirror counts.
  const rows = asked(runtime(1_000_000, 900_000, 1_000_000, DEVICE), 64);
  assert.equal(rows.drawSlots, 64, 'one row per slot, never one per page');
  assert.equal(rows.bounded, null, 'held by the slots, not by the device');
});

test('a cut past one binding is bounded for good, and names what it was asked for', () => {
  const rows = pageTableRows(DEVICE);
  assert.ok(rows * PAGE_INFO_STRIDE <= 128 * MIB, 'the bound is one binding, whole');
  assert.ok((rows + 1) * PAGE_INFO_STRIDE > 128 * MIB, 'and one row past it does not fit');
  // The slots must be able to ask for more than the binding holds, or nothing is ever bounded.
  const over = asked(runtime(1_000_000, 900_000, 1_000_000, DEVICE), 1_000_000);
  assert.ok(over.bounded, 'a table past one binding says so');
  assert.ok(over.drawSlots + over.blendSlots <= rows, 'and holds what the binding holds');
  assert.equal(over.bounded?.rows, rows);
});

test('no device: no bound, and every row the other two bounds allow', () => {
  assert.deepEqual(asked(runtime(100, 90, 1000, undefined, 4), 32), {
    drawSlots: 90,
    blendSlots: 10,
    bounded: null,
  });
});

test('the blend side is held to the same slot budget as the draw side', () => {
  // A scene of transparent pages only: the draw side falls to its one row, and what is left of the
  // slots may not be spent twice.
  const rows = asked(runtime(20, 0, 1000, DEVICE), 32);
  assert.ok(
    rows.drawSlots + rows.blendSlots <= 32,
    `the 32 slots hold ${rows.drawSlots + rows.blendSlots}`,
  );
});
