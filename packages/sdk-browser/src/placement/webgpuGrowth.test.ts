// A WebGPU session was opened again whenever an instance buffer grew — a partition's parent
// scaled down, a batch one mesh too full —, its pool, its texture tiles and its held image gone.
// It now grows the rows in place while its page table holds them (`webgpuGrowth.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { pageAddress } from '../webgpu/row/pageSlots.ts'
import { placedSession, scaleDown } from './webgpuGrowth.fixture.ts'
import { DRAW_ITEM_U32 } from '../gpu/draw/draw.ts'

test('a WebGPU session grows the rows of a scaled-down partition in place, within its page table', async () => {
  // Five rows: the ground and two rows of two leaves. The grown scene's nine pages would ask more,
  // and a session opened on it would hold these five, as this one does.
  const session = await placedSession(5)
  const { rt, cells, links, draw, reopened } = session
  try {
    const { layout } = rt,
      cache = rt.gpu.cache!
    const ground = layout.selectionRoots
      .flatMap((root) => root.pages)
      .find((page) => page.url === 'ground')!
    const before = {
      drawSlots: layout.drawSlots,
      table: layout.rows.pageTableFloats,
      slot: cache.get(pageAddress(ground))!.offset,
      ...cache.stats(),
    }
    const held = links.map((link) => link.placements!)
    await scaleDown(session)
    await draw()
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
    // Nothing was prepared again: the same table, the same pool, the ground in its slot, and no
    // page uploaded for the new rows, whose clusters read the slots their addresses hold.
    assert.equal(layout.drawSlots, before.drawSlots)
    assert.equal(layout.rows.pageTableFloats, before.table)
    assert.equal(rt.gpu.cache, cache)
    assert.equal(cache.get(pageAddress(ground))!.offset, before.slot)
    const after = cache.stats()
    assert.deepEqual(
      [after.residentPages, after.uploadedBytes],
      [before.residentPages, before.uploadedBytes],
    )
    for (let packed = 0; packed < layout.packedPages.length; packed++)
      assert.ok(layout.rows.residentOffsetWords[packed] >= 0, layout.recordOf(packed)!.url)
  } finally {
    session.dispose()
  }
})

test('a growth past the page table grows it in place: ranks, pins and pool kept', async () => {
  // A binding roomy enough for the table to hold every page: the grown scene asks more rows than
  // the five the session opened with.
  const session = await placedSession(1 << 12)
  const { rt, links, draw, reopened } = session
  try {
    const { layout, setup } = rt,
      cache = rt.gpu.cache!,
      { rows } = layout
    const pinned = () =>
      [...setup.tracking.pageCatalogIds].filter(([, key]) => setup.tracking.pinned.has(key))
    const before = {
      drawSlots: layout.drawSlots,
      ranks: Array.from(rows.rowOfPage.subarray(0, layout.packedPages.length)),
      pinned: pinned(),
      poolSlots: setup.slots,
      ...cache.stats(),
    }
    assert.ok(before.pinned.length && before.ranks.some((rank) => rank >= 0))
    const held = links.map((link) => link.placements!)
    await scaleDown(session)
    await layout.growing
    assert.equal(reopened.count, 0, 'no session opened again')
    assert.ok(links.every((link, at) => link.placements !== held[at]))
    assert.ok(layout.drawSlots > before.drawSlots, 'the table grew for the new rows')
    assert.equal(rows.generation, 1)
    const items = rt.vis.gpuDraw!.itemsBuffer.size / (DRAW_ITEM_U32 * 4)
    assert.deepEqual([items, rt.vis.gpuHiz!.flags.size / 4], [layout.drawSlots, layout.drawSlots])
    // Every page the table held keeps its rank, the pool its pins and its slots.
    const ranks = before.ranks.map((_, page) => rows.rowOfPage[page])
    assert.deepEqual(ranks, before.ranks)
    assert.deepEqual(pinned(), before.pinned)
    assert.equal(rt.gpu.cache, cache)
    assert.equal(setup.slots, before.poolSlots)
    await draw()
    const after = cache.stats()
    assert.deepEqual(
      [after.residentPages, after.uploadedBytes],
      [before.residentPages, before.uploadedBytes],
    )
    // The new rows' pages found rows: none waits for one.
    assert.equal(rows.candidateOverflow, 0)
    for (let packed = 0; packed < layout.packedPages.length; packed++)
      assert.ok(rows.residentOffsetWords[packed] >= 0, layout.recordOf(packed)!.url)
  } finally {
    session.dispose()
  }
})

test('a growth past the page table during a prepare is taken in place, the table growing after it', async () => {
  const session = await placedSession(1 << 12)
  const { rt, reopened } = session
  try {
    const { layout, setup } = rt,
      drawSlots = layout.drawSlots
    let prepared = () => {}
    setup.preparing = new Promise<void>((resolve) => (prepared = resolve))
    await scaleDown(session)
    assert.equal(reopened.count, 0, 'no session opened again')
    const growing = layout.growing
    await Promise.resolve()
    assert.equal(layout.drawSlots, drawSlots, 'the tables wait for the prepare')
    prepared()
    setup.preparing = undefined
    await growing
    assert.ok(layout.drawSlots > drawSlots, 'then grow for the new rows')
  } finally {
    session.dispose()
  }
})

test('the placement tables the group closure and page parents hold follow a growth in place', async () => {
  // Built once at open (`services.ts`), they would read the open's tables past a growth, and a page
  // of a new row would find no root.
  const session = await placedSession(5)
  try {
    const { layout } = session.rt,
      held = layout.placement
    await scaleDown(session)
    await session.draw()
    assert.equal(layout.placement, held, 'the same tables, rewritten in place')
    assert.equal(held.rootOfPacked.length, layout.packedPages.length, 'every instance ranked')
    assert.equal(held.baseOfRoot.length, layout.selectionRoots.length, 'every root based')
  } finally {
    session.dispose()
  }
})
