// #838: a WebGPU session was opened again whenever an instance buffer grew — a partition's parent
// scaled down, a batch one mesh too full —, its pool, its texture tiles and its held image gone.
// It now grows the rows in place while its page table holds them (`webgpuGrowth.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAddress } from '../webgpu/row/pageSlots.ts';
import { placedSession, scaleDown } from './webgpuGrowth.fixture.ts';

test('a WebGPU session grows the rows of a scaled-down partition in place, within its page table', async () => {
  // Five rows: the ground and two rows of two leaves. The grown scene's nine pages would ask more,
  // and a session opened on it would hold these five, as this one does.
  const session = await placedSession(5);
  const { rt, cells, links, draw, reopened } = session;
  try {
    const { layout } = rt,
      cache = rt.gpu.cache!;
    const ground = layout.packedPages.find((page) => page.url === 'ground')!;
    const before = {
      drawSlots: layout.drawSlots,
      table: layout.rows.pageTableFloats,
      slot: cache.get(pageAddress(ground))!.offset,
      ...cache.stats(),
    };
    const held = links.map((link) => link.placements!);
    scaleDown(session);
    await draw();
    assert.equal(reopened.count, 0, 'no session opened again');
    assert.deepEqual(cells.stats(), { cells: 2, held: 2, waiting: 0, rows: 4 });
    assert.ok(
      links.every((link, at) => link.placements!.capacity === 4 && link.placements !== held[at]),
    );
    // Every leaf root reads the grown rows: the two kept, two new ones per buffer, three taken.
    const leaves = layout.selectionRoots.filter((root) => root.placement);
    assert.equal(leaves.length, 8);
    assert.ok(
      leaves.every((root) => links.some((link) => link.placements === root.placement!.rows)),
    );
    assert.equal(leaves.filter((root) => !root.parked).length, 6);
    // Nothing was prepared again: the same table, the same pool, the ground in its slot, and no
    // page uploaded for the new rows, whose clusters read the slots their addresses hold.
    assert.equal(layout.drawSlots, before.drawSlots);
    assert.equal(layout.rows.pageTableFloats, before.table);
    assert.equal(rt.gpu.cache, cache);
    assert.equal(cache.get(pageAddress(ground))!.offset, before.slot);
    const after = cache.stats();
    assert.deepEqual(
      [after.residentPages, after.uploadedBytes],
      [before.residentPages, before.uploadedBytes],
    );
    for (const page of layout.packedPages)
      assert.ok(layout.rows.residentOffsetWords[page.packedIndex!] >= 0, page.url);
  } finally {
    session.dispose();
  }
});

test('a growth past the page table is refused: the rows stay as they are, the owner opens anew', async () => {
  // A binding roomy enough for the table to hold every page: the grown scene would ask more rows.
  const session = await placedSession(1 << 12);
  const { rt, links, reopened } = session;
  try {
    const held = links.map((link) => link.placements!),
      roots = rt.layout.selectionRoots.length;
    scaleDown(session);
    assert.equal(reopened.count, 1, 'the owner asked for a session sized for the rows');
    assert.ok(
      links.every((link, at) => link.placements === held[at]),
      'the rows it holds',
    );
    assert.equal(rt.layout.selectionRoots.length, roots);
  } finally {
    session.dispose();
  }
});
