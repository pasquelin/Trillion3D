// The prefiltered distant shadow's buffers and the frame's work over them (`resources.ts`,
// `pageManagementEncode.ts`, `frameUploads.ts`): made only with a layout that asks them, bound by
// name with the separable pool by the frame's parity, the arguments reset and the pools cleared before
// the filters in a frame with a map that holds the feature, the history kept at the frame's end and
// its ids and blend uploaded by the plan.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  dispatchedEntries,
  replayWrites,
} from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { pipelinesSettled } from '../../deferred/compileLedger.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import { VSM_PROJECTION_RECORD_BYTES } from './constants.ts'
import { MAPS } from './prefiltered.fixture.ts'
import { uploadFilterableHistory } from './frameUploads.ts'
import type { VsmFrameState } from './frameState.ts'
import type { VsmMapIds } from './mapIds.ts'
import { vsmResourceBytes } from './layoutBytes.ts'
import {
  encodeVsmPageMapping,
  keepFilterableHistory,
  resetVsmFilterable,
} from './pageManagementEncode.ts'
import type { VsmPageManagementFrame } from './pageManagementPass.ts'
import {
  VSM_FILTER_ARGS_INIT,
  VSM_FILTER_ARGS_WORDS,
  VSM_FILTERABLE_PAGE_BYTES,
  VSM_HISTORY_BLEND_WORD,
  VSM_HISTORY_SUN_WORD,
  VSM_MAP_PREFILTERED_DISTANT,
  vsmHistoryHeader,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'
import {
  createVsmResources,
  vsmBindGroupEntries,
  vsmBindingsWgsl,
  vsmFrameParity,
  type VsmBindingSpec,
} from './resources.ts'

const PAGE_OPTIONS = { stats: false, lruAllocation: true, fullClears: false } as const

const device = () =>
  fakeDevice({
    limits: { maxStorageBuffersPerShaderStage: 10, maxStorageBufferBindingSize: 1 << 27 },
  })

const frameOf = (fake: ReturnType<typeof device>, mapCount = 5): VsmPageManagementFrame => ({
  ...{ device: fake.device, mapCount, nextMapCount: 7 },
  perPageBins: [3, 2, 1, 4].map((count, b) => ({ offset: 2 * b, count })),
  directionalBins: [1, 0, 2, 0].map((count, b) => ({ offset: 2 * b, count })),
  options: { ...PAGE_OPTIONS, skipDynamicInvalidation: false },
})

test('only a layout that asks it makes the pools, the lists, the arguments and the history', () => {
  const off = device()
  const plain = createVsmResources(off.device, MAPS)
  assert.equal(plain.filterable, undefined)
  assert.ok(!off.buffers.some((buffer) => buffer.label?.startsWith('vsm.filterable')))
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  const { filterable } = res
  assert.ok(filterable)
  const sizeOf = (label: string) =>
    fake.buffers.find((buffer) => buffer.label === `vsm.${label}`)!.size
  const pool = 256 * VSM_FILTERABLE_PAGE_BYTES
  assert.deepEqual(['filterableSeparate0', 'filterableSeparate1', 'filterableMerged'].map(sizeOf), [
    pool,
    pool,
    pool,
  ])
  assert.ok(
    !fake.buffers.some((buffer) => buffer.label === 'vsm.filterableTemp'),
    'the merged pool is the temporary one',
  )
  assert.notEqual(filterable.separate[0], filterable.separate[1])
  assert.deepEqual([sizeOf('filterableArgs'), sizeOf('filterableArgsInit')], [48, 48])
  assert.equal(sizeOf('filterablePages'), 2 * 256 * 4)
  assert.equal(sizeOf('filterableHistory'), vsmHistoryLayout(res.layout).words * 4)
  assert.equal(filterable.historyValid, false)
  assert.equal(filterable.active, false)
  assert.equal(res.bytes, vsmResourceBytes(res.layout), 'the bytes counted are the bytes made')
  // The empty form of the arguments, written once to its own buffer; the history's header names its regions.
  const writesTo = (buffer: GPUBuffer) => fake.writes.filter((w) => w.buffer === buffer)
  const [init] = writesTo(filterable.argsInit)
  assert.deepEqual(Array.from(init.data), [...VSM_FILTER_ARGS_INIT])
  const [header] = writesTo(filterable.history)
  assert.deepEqual(
    Array.from(header.data),
    Array.from(vsmHistoryHeader(vsmHistoryLayout(res.layout), 0)),
  )
  assert.ok(filterable.args.usage & GPUBufferUsage.INDIRECT, 'dispatched from')
})

test('the filtered buffers bind by name, the separable pool by the frame’s parity', () => {
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  const specs: VsmBindingSpec[] = [
    { resource: 'filterableSeparate', binding: 0, access: 'atomic' },
    { resource: 'filterableSeparate', binding: 1, prev: true },
    { resource: 'filterableMerged', binding: 2 },
    { resource: 'filterableMerged', binding: 3, access: 'atomic', name: 'vsmFilterableTemp' },
    { resource: 'filterableArgs', binding: 4, access: 'atomic' },
    { resource: 'filterablePages', binding: 5, access: 'read_write' },
    { resource: 'filterableHistory', binding: 6 },
  ]
  const { separate, merged, args, pages, history } = res.filterable!
  const bound = () =>
    vsmBindGroupEntries(res, specs).map((entry) => (entry.resource as GPUBufferBinding).buffer)
  const parity = vsmFrameParity(res)
  assert.deepEqual(bound(), [
    ...[separate[parity], separate[1 - parity], merged, merged],
    ...[args, pages, history],
  ])
  res.swapFrames()
  assert.equal(vsmFrameParity(res), 1 - parity)
  assert.deepEqual(bound().slice(0, 2), [separate[1 - parity], separate[parity]], 'the pools swap')
  const text = wgslSource(vsmBindingsWgsl(1, specs, res.layout))
  for (const line of [
    '@group(1) @binding(0) var<storage,read_write> vsmFilterableSeparate:array<atomic<u32>>;',
    '@group(1) @binding(1) var<storage,read> vsmPrevFilterableSeparate:array<u32>;',
    '@group(1) @binding(3) var<storage,read_write> vsmFilterableTemp:array<atomic<u32>>;',
    'fn vsmFilterableMergedLoad(i:u32)->u32',
    'fn vsmFilterablePagesStore(i:u32,v:u32)',
    'fn vsmFilterableHistoryLoad(i:u32)->u32',
  ])
    assert.ok(text.includes(line), line)
  // A set without them refuses a spec that names them.
  const plain = createVsmResources(device().device, MAPS)
  assert.throws(() => vsmBindGroupEntries(plain, specs), /without the prefiltered distant shadow/)
})

test('a frame with a map that holds it resets the arguments from their own empty form and clears the pools it writes', () => {
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  const encoder = fake.device.createCommandEncoder()
  const { filterable } = res
  // No map holds the feature this frame: nothing.
  resetVsmFilterable(encoder, res, frameOf(fake))
  assert.deepEqual([fake.copies.length, fake.clears.length], [0, 0])
  filterable!.active = true
  resetVsmFilterable(encoder, res, frameOf(fake))
  assert.deepEqual(
    fake.copies.map(({ from, fromOffset, to, toOffset, size }) => [
      from,
      fromOffset,
      to,
      toOffset,
      size,
    ]),
    [[filterable!.argsInit, 0, filterable!.args, 0, VSM_FILTER_ARGS_WORDS * 4]],
  )
  assert.notEqual(fake.copies[0].from, fake.copies[0].to, 'a copy is never within one buffer')
  assert.deepEqual(
    fake.clears.map(({ buffer }) => buffer),
    [filterable!.separate[vsmFrameParity(res)], filterable!.merged],
  )
  // Nothing for a frame of no map, nor for a set without the filtered buffers.
  fake.copies.length = fake.clears.length = 0
  resetVsmFilterable(encoder, res, frameOf(fake, 0))
  resetVsmFilterable(encoder, createVsmResources(device().device, MAPS), frameOf(fake))
  assert.deepEqual([fake.copies.length, fake.clears.length], [0, 0])
})

test('the frame end keeps the suns’ records, the level-0 rows of the page table and the receiver cover, from a frame with data and a blend', () => {
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  const { history } = res.filterable!
  const layout = vsmHistoryLayout(res.layout)
  const { projectionData, pageTable, receiverCover } = res.current
  const encoder = fake.device.createCommandEncoder()
  res.filterable!.active = true
  keepFilterableHistory(res, true, 0, encoder)
  assert.equal(res.filterable!.historyValid, true)
  // The sun blocks of this set lie in one row of blocks: its first 128 rows of level 0 are copied.
  const rowBytes = res.layout.pageTableSize[0] * 4
  assert.deepEqual(
    fake.copies.map(({ from, to, fromOffset, toOffset, size }) => [
      from,
      to,
      fromOffset,
      toOffset,
      size,
    ]),
    [
      [projectionData, history, 0, layout.recordsWord * 4, layout.recordWords * 4],
      [pageTable, history, 0, layout.tableWord * 4, 128 * rowBytes],
      [receiverCover, history, 0, layout.coverWord * 4, layout.coverWords * 4],
    ],
  )
  // The suns’ records are copied from the first sun map’s, as many as the slots leave.
  fake.copies.length = 0
  keepFilterableHistory(res, true, 5, encoder)
  const first = fake.copies[0]!
  assert.deepEqual(
    [first.from, first.fromOffset],
    [projectionData, 5 * VSM_PROJECTION_RECORD_BYTES],
  )
  // A frame that granted no map or whose blend is 0 (`kept` false), or with no map that holds the
  // feature (not active): not valid, nothing copied.
  for (const [kept, active] of [
    [false, true],
    [true, false],
  ]) {
    res.filterable!.historyValid = true
    res.filterable!.active = active
    fake.copies.length = 0
    keepFilterableHistory(res, kept, 0, encoder)
    assert.equal(res.filterable!.historyValid, false, `${kept} ${active}`)
    assert.equal(fake.copies.length, 0)
  }
})

/** The plan's upload over a set whose history is `valid`, the blend the setting `blend`, a map of the
 *  cache holding the feature when `holds`: the history's words after it, in a zeroed buffer. */
function uploaded(valid: boolean, holds = true, blend = 0.87, bases = { previous: 0, current: 0 }) {
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  res.filterable!.historyValid = valid
  const flags = holds ? VSM_MAP_PREFILTERED_DISTANT : 0
  const state = {
    device: fake.device,
    resources: res,
    cache: {
      entries: new Map([[0, { mapId: 0, mapCaches: [{ projectionData: { flags } }] }]]),
      prevFrame: { mapCount: 50, sunBase: bases.previous },
    },
    maps: {
      shadows: { ...VSM_DEFAULT_SHADOWS, shadowPrefilteredDistantHistoryBlendFactor: blend },
    },
  } as unknown as VsmFrameState
  // Maps 3 and 4 of the frame before are 1 and 2 now; map 40 left the suns' slots.
  const { previous, current } = bases
  const ids = {
    nextMapIdCount: 3,
    nextMapIds: [previous + 3, previous + 4, previous + 40],
    nextMaps: Object.assign([], {
      [previous + 3]: { nextMapId: current + 1 },
      [previous + 4]: { nextMapId: current + 2 },
      [previous + 40]: { nextMapId: current + 5 },
    }),
    sunBase: current,
  } as unknown as VsmMapIds
  fake.writes.length = 0
  uploadFilterableHistory(state, ids)
  const history = vsmHistoryLayout(res.layout)
  const words = new ArrayBuffer(history.words * 4)
  replayWrites(
    words,
    fake.writes.filter((w) => w.buffer === res.filterable!.history),
  )
  return { history, words: new Uint32Array(words), active: res.filterable!.active }
}

test('the plan uploads the previous id + 1 of each map of the suns and the share of the frame before it keeps', () => {
  const { history, words, active } = uploaded(true)
  assert.equal(active, true)
  const ids = Array.from(words.subarray(history.idsWord, history.idsWord + history.idWords))
  assert.deepEqual(ids.slice(0, 3), [0, 4, 5], 'ids 1 and 2 follow 3 and 4; the others none')
  assert.ok(
    ids.slice(3).every((id) => id === 0),
    'and 40, past the suns’ slots, none',
  )
  assert.equal(words[VSM_HISTORY_BLEND_WORD], new Uint32Array(new Float32Array([0.87]).buffer)[0])
})

// The suns’ maps are addressed from the first of them, this frame’s in the ids and the previous
// frame’s in the records: the same pairs whatever the id the suns’ run starts at.
test('the plan addresses the suns from their first map, in this frame and the one before', () => {
  const { history, words } = uploaded(true, true, 0.87, { previous: 7, current: 11 })
  const ids = Array.from(words.subarray(history.idsWord, history.idsWord + history.idWords))
  assert.deepEqual(ids.slice(0, 3), [0, 4, 5])
  assert.equal(words[VSM_HISTORY_SUN_WORD], 11, 'the GPU is told where this frame’s suns start')
})

test('a history that holds no frame, or a frame with no map that holds the feature, uploads no id and a blend of 0', () => {
  for (const [valid, holds] of [
    [false, true],
    [true, false],
  ]) {
    const { history, words, active } = uploaded(valid, holds)
    assert.equal(active, holds)
    assert.ok(
      Array.from(words.subarray(history.idsWord, history.idsWord + history.idWords)).every(
        (id) => id === 0,
      ),
    )
    assert.equal(words[VSM_HISTORY_BLEND_WORD], 0)
  }
})

/** The entry points the page allocation dispatched, once its pipelines are compiled. */
async function mappingEntries(prefilteredDistant: boolean, active: boolean) {
  const fake = device()
  const steps = new ComputeRun().begin(fake.device.createCommandEncoder())
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant })
  if (res.filterable) res.filterable.active = active
  for (let again = 0; again < 2; again++) {
    fake.dispatches.length = 0
    encodeVsmPageMapping(steps, res, frameOf(fake))
    await pipelinesSettled(fake.device)
  }
  return dispatchedEntries(fake.dispatches)
}

test('the allocation passes the sun’s requests down first, over the suns’ bins, with the feature in a frame that holds it; else it starts as it did', async () => {
  const on = await mappingEntries(true, true)
  assert.equal(on[0], 'vsmPropagateFilterable')
  const count = (entries: string[], entry: string) => entries.filter((e) => e === entry).length
  // The directional-only bins [1, 0, 2, 0]: two are not empty; the others replay all four.
  assert.equal(count(on, 'vsmPropagateFilterable'), 2)
  assert.equal(count(on, 'vsmGrantPages'), 4)
  assert.ok(on.indexOf('vsmPropagateFilterable') < on.indexOf('vsmKeepPages'))
  for (const off of [await mappingEntries(false, false), await mappingEntries(true, false)]) {
    assert.equal(off[0], 'vsmKeepPages')
    assert.ok(!off.includes('vsmPropagateFilterable'))
  }
})
