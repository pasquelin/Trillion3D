// #838, #1483: a WebGPU session was opened again whenever an instance buffer grew — a partition's
// parent scaled down, a batch one mesh too full —, its pool, its texture tiles and its held image
// gone. Only the CPU cut grew in place; the GPU cut, the engine's one cut, now grows with the rows:
// a cut made over every root replaces the running one between two images (`webgpuGrowth.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { pageAddress } from '../webgpu/row/pageSlots.ts'
import { placedSession, scaleDown } from './webgpuGrowth.fixture.ts'

test('a WebGPU session grows the rows of a scaled-down partition in place, its GPU cut with them', async () => {
  const session = await placedSession(5)
  const { rt, cells, links, reopened } = session
  try {
    const { layout } = rt,
      cache = rt.gpu.cache!
    const ground = layout.selectionRoots
      .flatMap((root) => root.pages)
      .find((page) => page.url === 'ground')!
    const before = {
      cut: rt.run.gpuSelection!,
      ranks: Array.from(layout.rows.rowOfPage.subarray(0, layout.packedPages.length)),
      slot: cache.get(pageAddress(ground))!.offset,
      ...cache.stats(),
    }
    const held = links.map((link) => link.placements!)
    await scaleDown(session)
    await layout.growing
    assert.equal(reopened.count, 0, 'no session opened again')
    assert.deepEqual(cells.stats(), { pages: 3, cells: 2, held: 2, waiting: 0, rows: 4 })
    assert.ok(
      links.every((link, at) => link.placements!.capacity === 4 && link.placements !== held[at]),
    )
    // Every leaf root reads the grown rows: the two kept, two new ones per buffer, three taken.
    const leaves = layout.selectionRoots.filter((root) => root.placement)
    assert.equal(leaves.length, 8)
    assert.ok(
      leaves.every((root) => links.some((link) => link.placements === root.placement!.rows)),
    )
    assert.equal(leaves.filter((root) => !root.parked).length, 6)
    // A cut over every packed page replaced the one the session opened with.
    const cut = rt.run.gpuSelection!
    assert.notEqual(cut, before.cut, 'the cut grown with the rows')
    assert.equal(cut.pageCount, layout.packedPages.length)
    assert.equal(before.cut.failed(), true, 'the old cut is released')
    // Nothing else was prepared again: the table grew in place, every page it held at its rank
    // (`growTables.ts`), the same pool, the ground in its slot, and no page uploaded for the new
    // rows, whose clusters read the slots their addresses hold.
    assert.deepEqual(
      before.ranks.map((_, page) => layout.rows.rowOfPage[page]),
      before.ranks,
    )
    assert.equal(rt.gpu.cache, cache)
    assert.equal(cache.get(pageAddress(ground))!.offset, before.slot)
    const after = cache.stats()
    assert.deepEqual(
      [after.residentPages, after.uploadedBytes],
      [before.residentPages, before.uploadedBytes],
    )
    for (let packed = 0; packed < layout.packedPages.length; packed++)
      assert.ok(layout.rows.residentOffsetWords[packed] >= 0, layout.recordOf(packed)!.url)
    // The new rows draw: every page of a taken leaf holds a row once the grown cut asked for it.
    for (let frame = 0; frame < 4; frame++) await session.draw()
    const { baseOfRoot } = layout.placement
    layout.selectionRoots.forEach((root, rank) => {
      if (!root.placement || root.parked) return
      for (let at = 0; at < root.pages.length; at++)
        assert.ok(layout.rows.rowOfPage[baseOfRoot[rank] + at] >= 0, `root ${rank} draws`)
    })
  } finally {
    session.dispose()
  }
})

test('the placement tables the group closure and page parents hold follow a growth in place', async () => {
  // Built once at open (`services.ts`), they would read the open's tables past a growth, and a page
  // of a new row would find no root (#1235).
  const session = await placedSession(5)
  try {
    const { layout } = session.rt,
      held = layout.placement
    await scaleDown(session)
    assert.equal(layout.placement, held, 'the same tables, rewritten in place')
    assert.equal(held.rootOfPacked.length, layout.packedPages.length, 'every instance ranked')
    assert.equal(held.baseOfRoot.length, layout.selectionRoots.length, 'every root based')
  } finally {
    session.dispose()
  }
})
