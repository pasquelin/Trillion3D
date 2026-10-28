// The virtual shadow maps' buffer set (`resources.ts`): what it makes is what `vsmResourceBytes`
// counts without a device — its buffers and, with the occlusion culling, its pyramid and kept tables
// —, the page table, receiver covers and uncached rects are one buffer for both frames (no pass reads
// them as last frame's), and `destroy` frees every buffer and texture once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
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
import { VSM_PROJECTION_VSM_SPECS } from './projection/projectionWgsl.ts'
import { VSM_RENDER_CULL_SPECS } from './render/renderCullWgsl.ts'
import { VSM_RENDER_BIN_SPECS } from './render/renderBinWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_SHARED_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './render/renderRasterWgsl.ts'
import { SHADOW_POOL_BYTES } from '../../../session/memory/shadowBudgetBytes.ts'
import { vsmLayout, type VsmResourceOptions } from './layout.ts'
import { vsmResourceBytes } from './layoutBytes.ts'
import { MIB } from '../../../../../math/src/constants.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { keepOcclusionTables } from './occlusion/occlusionPass.ts'
import { VSM_KEPT_RECTS_WIDTH } from './constants.ts'

/** The shadows' GPU share in MiB (`SHADOW_POOL_BYTES`), the occlusion culling's resources in it, the receiver cover the default
 *  settings' (`'suns'`): the 921 749 336 B of `session/world/budget.test.ts` (879.05 MiB) rounded up to whole MiB. */
const SHADOW_MIB = 880
/** Directional maps a sun takes: its clipmap levels (`encodeVsm.ts`). */
const LEVELS = 17
const SHARED = ['pageTable', 'receiverCover', 'staleRects'] as const
const DOUBLED = [
  ...['uniforms', 'pageMarks', 'pageRequests', 'mappedRects', 'projectionData', 'freePages'],
] as const

/** A recording device whose storage bindings hold `binding` bytes. */
const deviceFor = (binding = 128 * MIB) =>
  fakeDevice({ limits: { maxStorageBufferBindingSize: binding } })

/** The bytes a recording device was asked for: its buffers and its textures. */
const madeBytes = (fake: ReturnType<typeof fakeDevice>) =>
  fake.buffers.reduce((sum, buffer) => sum + buffer.size, 0) +
  fake.textures.reduce(
    (sum, texture) => sum + madeTextureBytes(texture as unknown as GPUTexture),
    0,
  )

const CASES: [string, VsmResourceOptions, number?][] = [
  // As the engine makes them (`createEngineVsm`): two page-table rows, the mask for two suns.
  ['one sun', { coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 2 * LEVELS + 1 }],
  [
    'one sun, the mask its own levels',
    { coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 18 },
  ],
  ['three suns', { coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 3 * LEVELS + 1 }],
  ['127 maps, every one directional', { coverMode: 'suns', fullMapCapacity: 127 }],
  ['255 maps, the pool in parts', { coverMode: 'suns', fullMapCapacity: 255 }, 8 * MIB],
  ['a 4096-page pool', { coverMode: 'suns', fullMapCapacity: 127, poolPages: 4096 }],
  ['no masks, no cache slice', { coverMode: 'none', fullMapCapacity: 63, cacheEnabled: false }],
  ['no occlusion culling', { coverMode: 'suns', fullMapCapacity: 127, occlusion: false }],
  [
    'the receiver cover of every map',
    { coverMode: 'all', fullMapCapacity: 127, sunMapCapacity: 18 },
  ],
]

for (const [name, options, binding] of CASES)
  test(`vsmResourceBytes counts every byte createVsmResources makes: ${name}`, () => {
    const fake = deviceFor(binding)
    const res = createVsmResources(fake.device, options)
    const made = madeBytes(fake)
    assert.equal(res.bytes, made, 'res.bytes is what the device was asked for')
    assert.equal(vsmResourceBytes(res.layout), made)
    assert.equal(vsmResourceBytes(vsmLayout(options)), made)
  })

test('the page table, receiver covers and uncached rects are one buffer for both frames', () => {
  const fake = deviceFor()
  const res = createVsmResources(fake.device, { coverMode: 'suns', fullMapCapacity: 127 })
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
  // One copy fewer of each: 33.5 MiB at the engine's one-sun set (page table 12 MiB, masks
  // 17.5 MiB — its suns' maps, no single-page entry —, stale rects 4 MiB, a layer's each).
  const sun = createVsmResources(deviceFor().device, {
    coverMode: 'suns',
    fullMapCapacity: 127,
    sunMapCapacity: 2 * LEVELS + 1,
  })
  const { layout } = sun
  const saved = SHARED.reduce((sum, member) => sum + sun.frames[0][member].size, 0)
  assert.equal(saved, layout.pageTableWords * 4 + layout.coverWords * 4 + layout.pageRectCount * 32)
  assert.ok(Math.abs(saved - 33.5 * MIB) < 1024, `${saved}`)
})

test('destroy frees every buffer once, the shared ones included, and the occlusion textures', () => {
  const fake = deviceFor()
  const res = createVsmResources(fake.device, { coverMode: 'suns', fullMapCapacity: 127 })
  res.destroy()
  const made = [...fake.buffers, ...fake.textures] as { label?: string }[]
  // The pyramid and both frame sets' kept tables: a page table, marks and rects each.
  assert.equal(fake.textures.length, 7)
  assert.equal(fake.destroyed.length, made.length)
  assert.equal(new Set(fake.destroyed).size, made.length, 'none twice')
  for (const resource of made) assert.ok(fake.destroyed.includes(resource), resource.label)
})

test("a swap exchanges the doubled members and keeps the shared ones; prev binds last frame's", () => {
  const res = createVsmResources(deviceFor().device, { coverMode: 'suns', fullMapCapacity: 127 })
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
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127 })
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
    VSM_RENDER_BIN_SPECS,
    VSM_RENDER_RASTER_VERTEX_SPECS,
    VSM_RENDER_RASTER_FRAGMENT_SPECS,
    VSM_RENDER_RASTER_SHARED_SPECS,
  ]
  // What the invalidation and the page updates read of last frame: the doubled members, exactly.
  const lastFrame = new Set(
    lists.flatMap((specs) => specs.filter((s) => s.prev)).map((s) => s.resource),
  )
  assert.deepEqual([...lastFrame].sort(), [...DOUBLED].sort())
  for (const specs of lists) assert.doesNotThrow(() => vsmBindingsWgsl(0, specs, layout))
})

test('the projection buffer is a 400-byte record a slot, and the shadows hold their MiB of the GPU', () => {
  // `shadowBudgetBytes.ts` and `budget.fixture.ts` are both built from `vsmResourceBytes`, so a
  // record size that moved would move both and pass `world/budget.test.ts`: the numbers are here.
  const fake = deviceFor()
  const res = createVsmResources(fake.device, {
    coverMode: 'suns',
    fullMapCapacity: 63,
    sunMapCapacity: 18,
  })
  const records = fake.buffers.filter((buffer) =>
    /^vsm\.projectionData\d$/.test(buffer.label ?? ''),
  )
  assert.equal(records.length, 2, 'one a frame')
  // 400 since the record carries the occlusion's previous view (its id, table, clip matrix, depth
  // terms): 304 before.
  for (const buffer of records) assert.equal(buffer.size, res.layout.mapSlots * 400)
  assert.equal(vsmResourceBytes(res.layout), madeBytes(fake))
  // 633 MiB, 8 less than the 641 of the chunked raster: its 2²¹ pairs, commands and order took 36 B
  // a pair, the cull's records and the same sorted by tier take 32 (2²¹ of them), at 2²² · 1.5 records
  // now (`vsmRecordCapacity`, the reference's rule: 128 MiB more than at 2²¹). Then
  // the occlusion culling: its pyramid (85⅓ MiB at 4096 pages: 8192 × 2048 texels at level 0, seven
  // levels), both frame sets' kept tables (32 MiB: a page table, its marks and the stale rects each),
  // its page list and arguments, and the records' 96 more bytes (6.3 MiB over both frames); then
  // the receiver cover, the suns' alone at the default settings (every map's, which the local mask asks, is 22.5 MiB more: the
  // budget grants it where it is asked).
  assert.equal(SHADOW_POOL_BYTES / MIB, SHADOW_MIB)
})

// The occlusion's kept tables take only what the frame's maps hold (`encodeKeptTables`): the page
// table and its marks over the table blocks its maps were packed into — whole block rows, then the
// last row's first blocks — and its maps' stale rects. A sun's 17 levels in one block row: 3.2 MiB a
// frame where the whole tables were 12 MiB and 4 MiB of rects.
test('the kept tables copy the blocks and rects of the frame’s maps alone', () => {
  const fake = deviceFor()
  const res = createVsmResources(fake.device, { coverMode: 'suns', fullMapCapacity: 127 })
  const copied = (mapCount: number, blocks: number) => {
    fake.textureBufferCopies.length = 0
    const encoder = fake.device.createCommandEncoder()
    keepOcclusionTables(encoder, res, { mapCount, blocks })
    let bytes = 0
    for (const { size, destination } of fake.textureBufferCopies) {
      const [w, h] = size as number[]
      const { format } = (destination as GPUTexelCopyTextureInfo).texture
      bytes += w * h * (format === 'rgba32uint' ? 16 : 4)
    }
    return { bytes, regions: fake.textureBufferCopies.map((c) => [...(c.size as number[])]) }
  }
  const sun = copied(17, 17)
  assert.deepEqual(sun.regions, [
    [17 * 128, 192],
    [17 * 128, 192],
    [VSM_KEPT_RECTS_WIDTH, 2],
  ])
  // Its blocks of the table and of the marks, a word a texel, and its maps' two rect rows.
  assert.equal(sun.bytes, 2 * 17 * 128 * 192 * 4 + 2 * VSM_KEPT_RECTS_WIDTH * 16)
  assert.ok(sun.bytes < 3.3 * MIB && res.layout.pageTableWords * 8 >= 24 * MIB)
  // Past a block row: the whole rows, then the last row's blocks, each read where it lies.
  const many = copied(100, 70)
  assert.deepEqual(many.regions.slice(0, 4), [
    [8192, 192],
    [8192, 192],
    [6 * 128, 192],
    [6 * 128, 192],
  ])
  const last = fake.textureBufferCopies[2]
  assert.equal((last.source as GPUTexelCopyBufferInfo).offset, 192 * 8192 * 4)
  assert.deepEqual((last.destination as GPUTexelCopyTextureInfo).origin, [0, 192])
  assert.equal(
    many.bytes,
    2 * 70 * 128 * 192 * 4 + many.regions.at(-1)![1]! * VSM_KEPT_RECTS_WIDTH * 16,
  )
})
