// The frame's work over the prefiltered distant shadow's buffers (`pageManagementEncode.ts`,
// `frameUploads.ts`): the arguments reset and the pools cleared before the filters in a frame with a map
// that holds the feature, the history kept at the frame's end and its ids and blend uploaded by the plan.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dispatchedEntries,
  replayWrites,
} from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { pipelinesSettled } from '../../deferred/compileLedger.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import { VSM_PROJECTION_RECORD_BYTES } from './constants.ts'
import { MAPS } from './prefiltered.fixture.ts'
import { device, frameOf } from './prefilteredBuffers.fixture.ts'
import { uploadFilterableHistory } from './frameUploads.ts'
import type { VsmFrameState } from './frameState.ts'
import type { VsmMapIds } from './mapIds.ts'
import {
  encodeVsmPageMapping,
  keepFilterableHistory,
  resetVsmFilterable,
} from './pageManagementEncode.ts'
import {
  VSM_FILTER_ARGS_WORDS,
  VSM_HISTORY_BLEND_WORD,
  VSM_HISTORY_SUN_WORD,
  VSM_MAP_PREFILTERED_DISTANT,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'
import { createVsmResources, vsmFrameParity } from './resources.ts'

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
    // The page lists reset, then the keep rule; the lists packed and the empty pages appended before the grants.
    assert.deepEqual(off.slice(0, 5), [
      ...['vsmInitPageLists', 'vsmKeepPages', 'vsmPackAvailable'],
      ...['vsmAppendCopy', 'vsmAppendCounts'],
    ])
    assert.ok(!off.includes('vsmPropagateFilterable'))
    // The available pages appended to the requested ones last, after the feedback counted them.
    assert.deepEqual(off.slice(-3), ['vsmPoolFeedback', 'vsmAppendCopy', 'vsmAppendCounts'])
  }
})
