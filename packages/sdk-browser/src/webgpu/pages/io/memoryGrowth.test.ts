// #216: a geometry pool set above the ceiling the tables were sized for grows them in place, the
// session going on — and tables the device refuses keep the pool and every table as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setWebgpuMemoryBudgets } from './memory.ts'
import { SUN, coarseSession } from './memoryGrowth.fixture.ts'

test('a live setMemoryBudgets above the old ceiling grows the pool and the tables in place', async () => {
  const { rt, draw, drawn, dispose } = await coarseSession()
  try {
    const { layout, vis } = rt,
      cache = rt.gpu.cache!
    assert.deepEqual([rt.setup.slots, rt.setup.cap, layout.drawSlots], [2, 2, 2])
    assert.deepEqual(drawn(), ['2'], 'the coarse page alone, for want of room')
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.deepEqual([report.geometryPool.slots, report.geometryPool.clamp], [4, 'scene'])
    assert.deepEqual(
      [report.tables?.drawSlots, report.tables?.casterSlots, report.tables?.refused],
      [4, 4, false],
    )
    assert.ok(report.tables!.bytes > 0 && report.tables!.durationMs >= 0)
    // The whole catalogue now fits: the new pool holds each page at its own size.
    assert.equal(report.geometryPool.allocatedBytes, rt.setup.homes!.bytes)
    assert.ok(rt.setup.homes!.bytes < 4 * rt.setup.pageBytes)
    assert.equal(
      report.transientBytes,
      2 * rt.setup.pageBytes + rt.setup.homes!.bytes,
      'the old pool beside the new',
    )
    // The same session: its pool resized, its tables grown, nothing prepared again.
    assert.equal(rt.gpu.cache, cache)
    assert.deepEqual([rt.setup.cap, layout.drawSlots], [4, 4])
    assert.equal(vis.pageTable!.size, layout.rows.pageTableFloats!.byteLength)
    await draw(4)
    assert.deepEqual(drawn().sort(), ['0', '1'], 'the finer clusters, once resident')
  } finally {
    dispose()
  }
})

test('an allocation refusal during a grow leaves the pool and every table in place', async () => {
  const { rt, refusing, draw, drawn, dispose } = await coarseSession(SUN)
  try {
    const { layout, vis, gpu, lights } = rt
    const tables = () => ({
      drawSlots: layout.drawSlots,
      casterSlots: layout.rows.casterSlots,
      table: layout.rows.pageTableFloats,
      pageTable: vis.pageTable,
      zeroFlags: vis.zeroFlags,
      items: vis.gpuDraw?.itemsBuffer,
      flags: vis.gpuHiz?.flags,
      work: vis.gpuRestCompact?.work,
      spheres: lights.spheres?.buffer,
      mobility: lights.mobilityRows,
      corners: layout.cornerPacked,
      pool: rt.setup.geometryPool,
      cap: rt.setup.cap,
      cache: gpu.cache,
    })
    const before = tables()
    // The tested half's work buffer waits for its first pass, which this image did not take: the
    // grow would make it, and refused, still holds none.
    for (const [name, held] of Object.entries(before))
      if (name !== 'work') assert.ok(held !== undefined, `${name}: a table the grow replaces`)
    refusing.on = true
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.equal(report.tables?.refused, true)
    assert.equal(report.geometryPool.slots, 2, 'the pool in place is kept')
    assert.equal(report.evictedPages, 0)
    assert.deepEqual(tables(), before)
    assert.equal(layout.rows.generation, 0)
    // The session draws on, from what it holds.
    await draw()
    assert.deepEqual(drawn(), ['2'])
  } finally {
    dispose()
  }
})

test('a setting on a lost device grows the rows alone, and the budget is kept for the rebuild', async () => {
  const { rt, dispose } = await coarseSession()
  try {
    const { layout, vis } = rt,
      held = { table: vis.pageTable, items: vis.gpuDraw?.itemsBuffer }
    rt.run.lost = true
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.deepEqual(
      [report.tables?.refused, report.tables?.drawSlots, report.geometryPool.slots],
      [false, 4, 4],
      'no refusal: the host budget holds',
    )
    assert.deepEqual([layout.drawSlots, layout.rows.casterSlots, rt.setup.cap], [4, 4, 4])
    // Nothing is asked of the lost device: its tables are the rebuild's to make.
    assert.deepEqual({ table: vis.pageTable, items: vis.gpuDraw?.itemsBuffer }, held)
  } finally {
    dispose()
  }
})

test('the grown tables are granted before the new pool is probed beside them', async () => {
  const { rt, gpu, dispose } = await coarseSession()
  try {
    const labels: string[] = [],
      create = gpu.device.createBuffer.bind(gpu.device)
    gpu.device.createBuffer = (descriptor: GPUBufferDescriptor) => {
      if (descriptor.label) labels.push(descriptor.label)
      return create(descriptor)
    }
    await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    const table = labels.indexOf('Trillion3D page table'),
      probe = labels.indexOf('Trillion3D pool probe')
    assert.ok(table >= 0 && probe >= 0)
    assert.ok(table < probe, 'the probe asks for the pool beside the tables the device holds')
  } finally {
    dispose()
  }
})
