// The page table is one storage binding: a scene of many placements asked 209 MB of rows on
// ten-thousand-objects, past a 128 MiB binding, and the table could be neither made nor bound. Its
// rows are bounded by the device, shared between the two sides as asked (#974).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundTableRows, grownTableRows, pageTableRows } from './tableRows.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';

const MIB = 1 << 20;
const defaults = { maxStorageBufferBindingSize: 128 * MIB, maxBufferSize: 256 * MIB };

test('a table within one binding keeps every row it asked', () => {
  assert.deepEqual(boundTableRows(defaults, 1000, 200), {
    drawSlots: 1000,
    blendSlots: 200,
    bounded: null,
  });
  assert.equal(boundTableRows(undefined, 816_000, 0).drawSlots, 816_000, 'no device: no bound');
});

test('a table past one binding holds what the binding does, shared as asked', () => {
  const rows = pageTableRows(defaults);
  assert.ok(rows * PAGE_INFO_STRIDE <= 128 * MIB);
  assert.ok((rows + 1) * PAGE_INFO_STRIDE > 128 * MIB);
  const { drawSlots, blendSlots, bounded } = boundTableRows(defaults, 816_000, 0);
  assert.deepEqual([drawSlots, blendSlots], [rows, 0], 'no blend asked: every row draws');
  assert.deepEqual(bounded, { draw: 816_000, blend: 0, rows, bytes: rows * PAGE_INFO_STRIDE });
  const both = boundTableRows(defaults, 600_000, 200_000);
  assert.equal(both.drawSlots + both.blendSlots, rows, 'the binding, whole');
  assert.equal(both.blendSlots, Math.floor(rows / 4), 'a quarter asked, a quarter held');
  const tiny = boundTableRows({ maxStorageBufferBindingSize: 16 }, 50, 1);
  assert.deepEqual([tiny.drawSlots, tiny.blendSlots], [1, 1], 'one row each side at least');
});

// #216: a table grown in place for a larger pool keeps every row it holds, and a bound the device
// sets stays one binding even when the casters ask a larger share than the table opened with.
test('a grown table keeps its rows and stays within one binding', () => {
  const limits = { maxStorageBufferBindingSize: 100 * PAGE_INFO_STRIDE, maxBufferSize: 1 << 30 };
  const opened = boundTableRows(limits, 40, 40);
  const held = { blendFirst: opened.drawSlots, casterSlots: 80 };
  assert.deepEqual(grownTableRows(boundTableRows(limits, 50, 45), held), {
    drawSlots: 50,
    casterSlots: 95,
  });
  // The casters now ask 96 of the 100 rows: the 40 visibility rows stay, the casters take the rest.
  const asked = boundTableRows(limits, 40, 1000);
  assert.deepEqual([asked.drawSlots, asked.blendSlots], [4, 96]);
  assert.deepEqual(grownTableRows(asked, held), { drawSlots: 40, casterSlots: 100 });
});
