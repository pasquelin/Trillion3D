// The virtual shadow maps' buffer set (`resources.ts`): what it makes is what `vsmResourceBytes`
// counts without a device, the page table, receiver covers and uncached rects are one buffer for
// both frames (no pass reads them as last frame's), and `destroy` frees every buffer once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import {
  createVsmResources,
  vsmBindGroupEntries,
  vsmBindingsWgsl,
  type VsmBindingSpec,
} from './resources.ts'
import { VSM_INVALIDATION_SPECS } from './invalidationWgsl.ts'
import {
  VSM_CLEAR_SPECS,
  VSM_COARSE_SPECS,
  VSM_INIT_RECT_SPECS,
  VSM_PIXELS_SPECS,
} from './markingWgsl.ts'
import { vsmPageManagementKernels } from './pageManagementWgsl.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { VSM_PROJECTION_VSM_SPECS } from './projectionWgsl.ts'
import { VSM_RENDER_CULL_SPECS, VSM_RENDER_EXPAND_SPECS } from './renderCullWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './renderRasterWgsl.ts'
import { VSM_TRANSMISSION_CLEAR_SPECS } from './transmissionWgsl.ts'
import { SHADOW_POOL_BYTES } from '../residency/shadowBudgetBytes.ts'
import { vsmLayout, vsmResourceBytes, type VsmResourceOptions } from './layout.ts'

const MiB = 1024 * 1024
/** Directional maps a sun takes: its clipmap levels (`encodeVsm.ts`). */
const LEVELS = 17
const SHARED = ['pageTable', 'receiverCover', 'staleRects'] as const
const DOUBLED = [
  'uniforms',
  'pageMarks',
  'pageRequests',
  'mappedRects',
  'projectionData',
  'poolLists',
] as const

/** A recording device whose storage bindings hold `binding` bytes. */
const deviceFor = (binding = 128 * MiB) =>
  fakeDevice({ limits: { maxStorageBufferBindingSize: binding } })

const CASES: [string, VsmResourceOptions, number?][] = [
  // As the engine makes them (`createEngineVsm`): two page-table rows, the mask for two suns.
  ['one sun', { fullMapCapacity: 127, sunMapCapacity: 2 * LEVELS + 1 }],
  ['one sun, the mask its own levels', { fullMapCapacity: 127, sunMapCapacity: 18 }],
  ['three suns', { fullMapCapacity: 127, sunMapCapacity: 3 * LEVELS + 1 }],
  ['127 maps, every one directional', { fullMapCapacity: 127 }],
  ['255 maps, the pool in parts', { fullMapCapacity: 255 }, 8 * MiB],
  ['a 4096-page pool', { fullMapCapacity: 127, poolPages: 4096 }],
  ['local masks, no cache slice', { fullMapCapacity: 63, coverMode: 'local', cacheEnabled: false }],
]

for (const [name, options, binding] of CASES)
  test(`vsmResourceBytes counts every byte createVsmResources makes: ${name}`, () => {
    const fake = deviceFor(binding)
    const res = createVsmResources(fake.device, options)
    const made = fake.buffers.reduce((sum, buffer) => sum + buffer.size, 0)
    assert.equal(res.bytes, made, 'res.bytes is what the device was asked for')
    assert.equal(vsmResourceBytes(res.layout), made)
    assert.equal(vsmResourceBytes(vsmLayout(options, binding ?? 128 * MiB)), made)
  })

test('the page table, receiver covers and uncached rects are one buffer for both frames', () => {
  const fake = deviceFor()
  const res = createVsmResources(fake.device, { fullMapCapacity: 127 })
  const [a, b] = res.frames
  for (const member of SHARED) {
    assert.equal(a[member], b[member], member)
    assert.equal(
      fake.buffers.filter((buffer) => buffer === (a[member] as object)).length,
      1,
      member,
    )
    assert.equal(a[member].label, `vsm.${member}`)
  }
  for (const member of DOUBLED) assert.notEqual(a[member], b[member], member)
  // Every member of a frame is listed above, and the frames hold no buffer twice otherwise.
  assert.deepEqual(Object.keys(a).sort(), [...SHARED, ...DOUBLED].sort())
  const distinct = new Set([...Object.values(a), ...Object.values(b)])
  assert.equal(distinct.size, SHARED.length + 2 * DOUBLED.length)
  // One copy fewer of each: 32 MiB at the engine's one-sun set (page table 12 MiB, masks 18 MiB,
  // rects 2 MiB).
  const sun = createVsmResources(deviceFor().device, {
    fullMapCapacity: 127,
    sunMapCapacity: 2 * LEVELS + 1,
  })
  const { layout } = sun
  const saved = SHARED.reduce((sum, member) => sum + sun.frames[0][member].size, 0)
  assert.equal(saved, layout.pageTableWords * 4 + layout.coverWords * 4 + layout.pageRectCount * 16)
  assert.ok(Math.abs(saved - 32 * MiB) < 1024, `${saved}`)
})

test('destroy frees every buffer once, the shared ones included', () => {
  const fake = deviceFor()
  const res = createVsmResources(fake.device, { fullMapCapacity: 127 })
  res.destroy()
  assert.equal(fake.destroyed.length, fake.buffers.length)
  assert.equal(new Set(fake.destroyed).size, fake.buffers.length, 'none twice')
  for (const buffer of fake.buffers) assert.ok(fake.destroyed.includes(buffer), buffer.label)
})

test("a swap exchanges the doubled members and keeps the shared ones; prev binds last frame's", () => {
  const res = createVsmResources(deviceFor().device, { fullMapCapacity: 127 })
  const [a, b] = res.frames
  res.swapFrames()
  assert.equal(res.current, b)
  assert.equal(res.prev, a)
  const bound = (specs: VsmBindingSpec[]) =>
    vsmBindGroupEntries(res, specs).map(({ resource }) => (resource as GPUBufferBinding).buffer)
  assert.deepEqual(
    bound([
      { resource: 'pageRequests', binding: 0, prev: true },
      { resource: 'pageRequests', binding: 1 },
      { resource: 'pageTable', binding: 2 },
    ]),
    [a.pageRequests, b.pageRequests, a.pageTable],
  )
  assert.equal(res.current.pageTable, res.prev.pageTable)
})

test("no pass binds a shared member as last frame's: such a spec is refused at its shader", () => {
  const layout = vsmLayout({ fullMapCapacity: 127 }, 128 * MiB)
  for (const resource of SHARED)
    assert.throws(
      () => vsmBindingsWgsl(0, [{ resource, binding: 0, prev: true }], layout),
      new RegExp(`${resource} keeps no previous frame`),
    )
  // Every pass's own bindings still build: their last-frame reads are of doubled members only.
  const kernels = [
    ...Object.values(vsmPhysicalPageKernels(layout)),
    ...Object.values(vsmPhysicalPageKernels(layout, { stats: true })),
    ...Object.values(vsmPageManagementKernels(layout)),
  ]
  const lists: (readonly VsmBindingSpec[])[] = [
    ...kernels.map((kernel) => kernel.specs),
    VSM_INVALIDATION_SPECS,
    VSM_CLEAR_SPECS,
    VSM_INIT_RECT_SPECS,
    VSM_COARSE_SPECS,
    VSM_PIXELS_SPECS,
    VSM_PROJECTION_VSM_SPECS,
    VSM_RENDER_CULL_SPECS,
    VSM_RENDER_EXPAND_SPECS,
    VSM_RENDER_RASTER_VERTEX_SPECS,
    VSM_RENDER_RASTER_FRAGMENT_SPECS,
    VSM_TRANSMISSION_CLEAR_SPECS,
  ]
  // What the invalidation and the page updates read of last frame: the doubled members, exactly.
  const lastFrame = new Set(
    lists.flatMap((specs) => specs.filter((s) => s.prev)).map((s) => s.resource),
  )
  assert.deepEqual([...lastFrame].sort(), [...DOUBLED].sort())
  for (const specs of lists) assert.doesNotThrow(() => vsmBindingsWgsl(0, specs, layout))
})

test('the projection buffer is a 288-byte record a slot, and the shadows hold 404 MiB of the GPU', () => {
  // `shadowBudgetBytes.ts` and `budget.fixture.ts` are both built from `vsmResourceBytes`, so a
  // record size that moved would move both and pass `worldBudget.test.ts`: the numbers are here.
  const fake = deviceFor()
  const res = createVsmResources(fake.device, {
    fullMapCapacity: 63,
    sunMapCapacity: 18,
  })
  const records = fake.buffers.filter((buffer) =>
    /^vsm\.projectionData\d$/.test(buffer.label ?? ''),
  )
  assert.equal(records.length, 2, 'one a frame')
  for (const buffer of records) assert.equal(buffer.size, res.layout.mapSlots * 288)
  assert.equal(
    vsmResourceBytes(res.layout),
    fake.buffers.reduce((sum, buffer) => sum + buffer.size, 0),
  )
  assert.equal(SHADOW_POOL_BYTES / MiB, 404)
})
