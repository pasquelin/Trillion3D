import test from 'node:test';
import assert from 'node:assert/strict';
import type { ManifestPages } from '../../../../sdk-core/src/manifest/paged.ts';
import { createCellPages } from './cellPages.ts';

/** Pages held by a count, as `openPagedManifest` holds them: a hold whose read fails undoes its own
 *  count; `fail` names the slots whose read fails, `landing` settles the reads asked so far. */
function countedPages(fail: ReadonlySet<string>) {
  const counts = new Map<string, number>();
  let land = () => {};
  const landing = new Promise<void>((resolve) => (land = resolve));
  const pages = {
    primitives: [],
    changes: 0,
    async hold(slots) {
      for (const slot of slots) counts.set(slot, (counts.get(slot) ?? 0) + 1);
      await landing;
      if (!slots.some((slot) => fail.has(slot))) return;
      pages.release(slots);
      throw new Error('read failed');
    },
    release(slots) {
      for (const slot of slots) counts.set(slot, counts.get(slot)! - 1);
    },
  } satisfies ManifestPages;
  return { pages, counts, land };
}

/** Each cell's mesh pages, `lists[cell]`. */
const cell =
  (...lists: string[][]) =>
  (at: number) =>
    lists[at];

// #751: a cell that leaves while its read is in flight, the read then failing, drops no page
// another placed cell still holds.
test('a cell that leaves mid-read releases nothing more when its read fails', async () => {
  const { pages, counts, land } = countedPages(new Set(['y']));
  const held = createCellPages(pages, cell(['x', 'y'], ['x']));
  held.hold(0);
  held.hold(1);
  held.release(0);
  land();
  await Promise.all(held.reads());
  assert.deepEqual([counts.get('x'), counts.get('y'), held.held()], [1, 0, 1]);
});

test('a cell that leaves mid-read releases its pages once they land', async () => {
  const { pages, counts, land } = countedPages(new Set());
  const held = createCellPages(pages, cell(['x']));
  held.hold(0);
  held.release(0);
  land();
  await Promise.all(held.reads());
  assert.deepEqual([counts.get('x'), held.held()], [0, 0]);
});
