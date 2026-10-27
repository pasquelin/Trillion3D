// The prefiltered distant shadow's layout and sizes (`prefilteredConstants.ts`): the history's regions,
// the bytes the layout counts, and the helpers its WGSL (`prefilteredWgsl.ts`) gives over a record and a page table entry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { VSM_PAGE_TEXELS, VSM_PROJECTION_RECORD_BYTES, VSM_STATS_WORDS } from './constants.ts'
import { vsmLayout } from './layout.ts'
import {
  bufferBytes,
  filterableBufferSizes,
  filterableHistoryBytes,
  setBufferSizes,
  vsmResourceBytes,
  vsmTableBytes,
} from './layoutBytes.ts'
import {
  VSM_ENTRY_SECONDARY_BIT,
  VSM_FILTER_LISTS,
  VSM_FILTERABLE_PAGE_BYTES,
  VSM_HISTORY_BLEND_WORD,
  VSM_HISTORY_SUN_WORD,
  VSM_MAP_LEVEL_INDEX_SHIFT,
  VSM_MAP_PREFILTERED_DISTANT,
  vsmFilterablePoolBytes,
  vsmHistoryHeader,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'
import { VSM_HISTORY_WGSL, VSM_PREFILTERED_WGSL } from './prefilteredWgsl.ts'

const OFF = vsmLayout({
  coverMode: 'suns',
  fullMapCapacity: 127,
  sunMapCapacity: 18,
  poolPages: 256,
})
const ON = vsmLayout({
  coverMode: 'suns',
  fullMapCapacity: 127,
  sunMapCapacity: 18,
  poolPages: 256,
  prefilteredDistant: true,
})

test('the WGSL helpers read a record and an entry', () => {
  const helpers = shaderRun<{
    vsmEntrySecondary(entry: number): boolean
    vsmMapPrefiltered(pd: object): boolean
    vsmClipmapLevelIndex(pd: object): number
  }>(VSM_PREFILTERED_WGSL, ['vsmEntrySecondary', 'vsmMapPrefiltered', 'vsmClipmapLevelIndex'], {})
  // Bit 29 of an entry; the mapped and drawable bits and an address alone are no secondary request.
  assert.equal(helpers.vsmEntrySecondary(0x20000000), true)
  assert.equal(helpers.vsmEntrySecondary(0xc0000000 | 0x3ff), false)
  assert.equal(helpers.vsmEntrySecondary(0xe0000000 | 5), true)
  // The record's flag, and the level index in the flags' bits 8 to 15.
  const flags = VSM_MAP_PREFILTERED_DISTANT | (9 << VSM_MAP_LEVEL_INDEX_SHIFT) | 3
  assert.equal(helpers.vsmMapPrefiltered({ flags }), true)
  assert.equal(helpers.vsmMapPrefiltered({ flags: flags & ~VSM_MAP_PREFILTERED_DISTANT }), false)
  assert.equal(helpers.vsmClipmapLevelIndex({ flags }), 9)
  assert.equal(helpers.vsmClipmapLevelIndex({ flags: VSM_MAP_PREFILTERED_DISTANT }), 0)
  assert.equal(helpers.vsmClipmapLevelIndex({ flags: 30 << VSM_MAP_LEVEL_INDEX_SHIFT }), 30)
})

test('a texel of a level lies in a page, at a place in it', () => {
  const { vsmLevelTexelAt: at } = shaderRun<{
    vsmLevelTexelAt(texel: number[]): { vPage: number[]; inPage: number[] }
  }>(VSM_PREFILTERED_WGSL, ['vsmLevelTexelAt'], { VSM_PAGE_TEXELS })
  assert.deepEqual(at([130.5, 5.25]), { vPage: [1, 0], inPage: [2.5, 5.25] })
  assert.deepEqual(at([-0.5, 255.75]), { vPage: [-1, 1], inPage: [127.5, 127.75] })
})

test('a granted secondary page has its entry’s bit 29 and the same address as any granted page', () => {
  const entry = shaderRun<{
    vsmPackSecondaryTableEntry(address: number[], secondary: boolean): number
  }>(VSM_PREFILTERED_WGSL, ['vsmPackSecondaryTableEntry'], {})
  // Page (3, 4): the address, then mapped and drawable (bits 31 and 30).
  const plain = (0x80000000 | 0x40000000 | (4 << 10) | 3) >>> 0
  assert.equal(entry.vsmPackSecondaryTableEntry([3, 4], false) >>> 0, plain)
  assert.equal(
    entry.vsmPackSecondaryTableEntry([3, 4], true) >>> 0,
    (plain | VSM_ENTRY_SECONDARY_BIT) >>> 0,
  )
})

test('the history lays the ids, the suns’ records, page table rows and cover one after the other', () => {
  const history = vsmHistoryLayout(ON)
  const recordWords = VSM_PROJECTION_RECORD_BYTES / 4
  assert.equal(ON.sunMapSlots, 18)
  const headerWords = vsmHistoryHeader(history, 0).length
  assert.deepEqual([history.idsWord, history.idWords], [headerWords, 18])
  assert.deepEqual(
    [history.recordsWord, history.recordWords],
    [history.idsWord + 18, 18 * recordWords],
  )
  // One row of page table blocks holds the suns' 18; a block is 192 rows of the table's width.
  assert.equal(history.tableWords, 192 * ON.pageTableSize[0])
  assert.equal(history.coverWords, ON.coverSize[0] * ON.coverSize[1])
  assert.equal(history.tableWord, history.recordsWord + history.recordWords)
  assert.equal(history.coverWord, history.tableWord + history.tableWords)
  assert.equal(history.words, history.coverWord + history.coverWords)
  assert.equal(filterableHistoryBytes(ON), history.words * 4)
  // More suns than a row of blocks hold take another row of the table.
  const wide = vsmLayout({
    coverMode: 'suns',
    fullMapCapacity: 255,
    sunMapCapacity: 70,
    prefilteredDistant: true,
  })
  assert.equal(vsmHistoryLayout(wide).tableWords, 2 * 192 * wide.pageTableSize[0])
  // A set of every map’s cover keeps the cover whole, its first level.
  const every = vsmLayout({
    coverMode: 'all',
    fullMapCapacity: 127,
    sunMapCapacity: 18,
    prefilteredDistant: true,
  })
  assert.equal(vsmHistoryLayout(every).coverWords, every.coverSize[0] * every.coverSize[1])
})

test('the history’s header names its regions and holds the blend', () => {
  const history = vsmHistoryLayout(ON)
  const blend = new Uint32Array(new Float32Array([0.87]).buffer)[0]
  assert.deepEqual(
    Array.from(vsmHistoryHeader(history, blend)),
    [history.recordsWord, history.tableWord, history.coverWord, history.idsWord, blend, 0],
    'the first sun map’s id starts at 0',
  )
  const headerWords = vsmHistoryHeader(history, blend).length
  assert.equal(VSM_HISTORY_BLEND_WORD, headerWords - 2)
  assert.equal(VSM_HISTORY_SUN_WORD, headerWords - 1)
  // The WGSL reads the same words, through the history's loader.
  const reads = (word: number) => `vsmFilterableHistoryLoad(${word}u)`
  const text = VSM_HISTORY_WGSL.text
  for (const [fn, word] of [
    ['vsmHistoryRecordsWord', 0],
    ['vsmHistoryTableWord', 1],
    ['vsmHistoryCoverWord', 2],
    ['vsmHistoryIdsWord', 3],
  ] as const)
    assert.ok(text.includes(`fn ${fn}()->u32{return ${reads(word)};}`), fn)
  const header = Array.from(vsmHistoryHeader(history, blend))
  const run = shaderRun<{ vsmHistoryTableWord(): number; vsmHistoryIdsWord(): number }>(
    VSM_HISTORY_WGSL,
    ['vsmHistoryTableWord', 'vsmHistoryIdsWord'],
    { vsmFilterableHistoryLoad: (i: number) => header[i] },
  )
  assert.deepEqual(
    [run.vsmHistoryTableWord(), run.vsmHistoryIdsWord()],
    [history.tableWord, history.idsWord],
  )
})

test('a set without the prefiltered distant shadow holds none of its buffers, and its stats are the counters and the flags word', () => {
  assert.equal(OFF.prefilteredDistant, false)
  assert.equal(ON.prefilteredDistant, true)
  assert.equal(setBufferSizes(OFF).stats, VSM_STATS_WORDS * 4)
  assert.equal(setBufferSizes(ON).stats, VSM_STATS_WORDS * 4)
  const sizes = filterableBufferSizes(ON)
  // Two separate pools, the merged one, the arguments, their empty form and the lists.
  const made = bufferBytes(sizes.separate) * 2 + bufferBytes(sizes.merged)
  const small = bufferBytes(sizes.args) + bufferBytes(sizes.argsInit) + bufferBytes(sizes.pages)
  const history = bufferBytes(filterableHistoryBytes(ON))
  assert.equal(vsmResourceBytes(ON) - vsmResourceBytes(OFF), made + small + history)
  assert.equal(vsmTableBytes(ON) - vsmTableBytes(OFF), history, 'the history is the tables’')
})

test('the pools are byte pages a pool page, the temporary pool the merged one’s', () => {
  const sizes = filterableBufferSizes(ON)
  const pool = 256 * VSM_FILTERABLE_PAGE_BYTES
  assert.deepEqual([sizes.separate, sizes.merged, vsmFilterablePoolBytes(ON)], [pool, pool, pool])
  assert.equal(sizes.pages, VSM_FILTER_LISTS * 256 * 4, 'two lists of a word a pool page')
})
