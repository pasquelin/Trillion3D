// A geometry pool set above the ceiling it was sized for grows in place, the session going on — and
// a pool the device refuses keeps the pool and every table as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setWebgpuMemoryBudgets } from './memory.ts'
import { coarseSession } from './memoryGrowth.fixture.ts'

test('a live setMemoryBudgets above the old ceiling grows the pool in place', async () => {
  const { rt, draw, drawn, dispose } = await coarseSession()
  try {
    const cache = rt.gpu.cache!
    // The root's grain alone, a slot holding one page.
    assert.equal(rt.setup.slots, 1)
    assert.deepEqual(drawn(), ['3'], 'the root alone, for want of room')
    const rootBytes = rt.setup.geometryPool.allocatedBytes
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.deepEqual([report.geometryPool.slots, report.geometryPool.clamp], [4, 'scene'])
    // The whole catalogue now fits: the new pool holds each page at its own size.
    assert.equal(report.geometryPool.allocatedBytes, rt.setup.homes!.bytes)
    assert.ok(rt.setup.homes!.bytes < 4 * rt.setup.pageBytes)
    assert.equal(
      report.transientBytes,
      rootBytes + rt.setup.homes!.bytes,
      'the old pool beside the new',
    )
    // The same session: its pool resized, nothing prepared again.
    assert.equal(rt.gpu.cache, cache)
    await draw(4)
    assert.deepEqual(drawn().sort(), ['0', '1'], 'the finer clusters, once resident')
  } finally {
    dispose()
  }
})

test('an allocation refusal during a grow leaves the pool and every table in place', async () => {
  const { rt, refusing, draw, drawn, dispose } = await coarseSession()
  try {
    const { vis, gpu } = rt
    const tables = () => ({
      pageTable: vis.pageTable,
      zeroRows: vis.zeroRows,
      bins: vis.gpuBins,
      pool: rt.setup.geometryPool,
      cache: gpu.cache,
    })
    const before = tables()
    for (const [name, held] of Object.entries(before))
      assert.ok(held !== undefined, `${name}: a table the grow leaves alone`)
    refusing.on = true
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.equal(report.geometryPool.slots, 1, 'the pool in place is kept')
    assert.equal(report.evictedPages, 0)
    assert.deepEqual(tables(), before)
    // The session draws on, from what it holds.
    await draw()
    assert.deepEqual(drawn(), ['3'])
  } finally {
    dispose()
  }
})

test('a setting on a lost device is kept for the rebuild, and asks nothing of the device', async () => {
  const { rt, dispose } = await coarseSession()
  try {
    const { vis } = rt,
      held = { table: vis.pageTable, bins: vis.gpuBins }
    rt.run.lost = true
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.equal(report.geometryPool.slots, 4, 'the host budget holds')
    // Nothing is asked of the lost device: its tables are the rebuild's to make.
    assert.deepEqual({ table: vis.pageTable, bins: vis.gpuBins }, held)
  } finally {
    dispose()
  }
})
