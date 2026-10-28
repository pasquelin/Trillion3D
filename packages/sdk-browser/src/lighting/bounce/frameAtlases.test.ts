// The atlases of a frame the radiance cache keeps while their extent holds the queue's block.

import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheTempBytes, cacheTraceBytes } from './cache/cacheLayout.ts'
import {
  dropTemp,
  dropTraceAtlas,
  tempFor,
  traceAtlasFor,
  type FrameAtlases,
} from './cache/frameAtlases.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

/** The updates in a row at a quarter of the texels held that make an atlas again at the size asked. */
const SHRINK_AFTER_UPDATES = 30

/** No atlas held, and the storage of maps of 16 texels with the sky's visibility. */
function emptyAtlases() {
  const { device } = fakeDevice()
  const shape = { resolution: 16, mipmaps: 1, skyVisibility: true, light: 'r32uint' as const }
  const state: FrameAtlases = {
    device,
    temp: undefined,
    traceAtlas: undefined,
    smallTemp: 0,
    smallTrace: 0,
  }
  const storage = { shape } as unknown as Parameters<typeof tempFor>[1]
  return { state, shape, storage }
}

test('the atlases of a frame are kept while their extent holds the queue’s block and made again past it, their bytes counted', () => {
  const { state, shape, storage } = emptyAtlases()
  const first = tempFor(state, storage, { row: 8, probes: 64 })!
  assert.deepEqual(first.extent, [128, 128])
  assert.equal(first.bytes, cacheTempBytes(shape, { row: 8, probes: 64 }))
  assert.equal(first.bytes, 128 * 128 * 4 * 2, 'the light and the sky’s share, four bytes a texel')
  // A smaller block, laid out in a narrower row, fits the extent held.
  assert.equal(tempFor(state, storage, { row: 4, probes: 16 }), first)
  // A row wider than the atlas, or more rows than it holds, does not.
  const wider = tempFor(state, storage, { row: 16, probes: 16 })!
  assert.notEqual(wider, first)
  assert.deepEqual(wider.extent, [256, 16])
  const taller = tempFor(state, storage, { row: 16, probes: 64 })!
  assert.deepEqual(taller.extent, [256, 64])
  // Another shape of maps asks its own.
  const other = { shape: { ...shape, skyVisibility: false } } as unknown as Parameters<
    typeof tempFor
  >[1]
  assert.notEqual(tempFor(state, other, { row: 16, probes: 64 }), taller)
  // The trace atlas holds whole rows of 512 tiles, and is kept for as many tiles as they hold.
  const atlas = traceAtlasFor(state, 1000, WORD_LIGHT_FORMAT)!
  assert.equal(atlas.tiles, 1024)
  assert.equal(atlas.bytes, cacheTraceBytes(1024, WORD_LIGHT_FORMAT))
  assert.equal(traceAtlasFor(state, 600, WORD_LIGHT_FORMAT), atlas)
  assert.equal(
    traceAtlasFor(state, 1024, WORD_LIGHT_FORMAT),
    atlas,
    'a few more tiles within the last row',
  )
  assert.notEqual(traceAtlasFor(state, 1025, WORD_LIGHT_FORMAT), atlas)
})

test('the atlases of a frame shrink once the updates have stayed at a quarter of their texels, and any larger update in the run starts it over', () => {
  const { state, storage } = emptyAtlases()
  const full = tempFor(state, storage, { row: 16, probes: 256 })!
  const small = { row: 4, probes: 16 }
  for (let update = 1; update < SHRINK_AFTER_UPDATES; update++)
    assert.equal(tempFor(state, storage, small), full, `update ${update} keeps the atlas`)
  // A larger block (still within the quarter's bound, not under it) breaks the run.
  assert.equal(tempFor(state, storage, { row: 16, probes: 128 }), full)
  for (let update = 1; update < SHRINK_AFTER_UPDATES; update++)
    assert.equal(tempFor(state, storage, small), full)
  const shrunk = tempFor(state, storage, small)!
  assert.notEqual(shrunk, full)
  assert.deepEqual(shrunk.extent, [64, 64])
  assert.equal(tempFor(state, storage, small), shrunk, 'kept again at the size asked')

  const wide = traceAtlasFor(state, 4000, WORD_LIGHT_FORMAT)!
  for (let update = 1; update < SHRINK_AFTER_UPDATES; update++)
    assert.equal(traceAtlasFor(state, 100, WORD_LIGHT_FORMAT), wide)
  const narrow = traceAtlasFor(state, 100, WORD_LIGHT_FORMAT)!
  assert.notEqual(narrow, wide)
  assert.equal(narrow.tiles, 512, 'one row, the least an atlas holds')
})

test('an update counts toward the shrink while it asks at most a quarter of the tiles held, and one asking more starts the count over', () => {
  const { state } = emptyAtlases()
  // 4096 tiles held: 1024 is a quarter of them exactly, 1025 more than that.
  const held = traceAtlasFor(state, 4096, WORD_LIGHT_FORMAT)!
  for (let update = 1; update < SHRINK_AFTER_UPDATES; update++)
    assert.equal(traceAtlasFor(state, 1024, WORD_LIGHT_FORMAT), held)
  assert.equal(
    traceAtlasFor(state, 1025, WORD_LIGHT_FORMAT),
    held,
    'past a quarter: kept, the count started over',
  )
  for (let update = 1; update < SHRINK_AFTER_UPDATES; update++)
    assert.equal(traceAtlasFor(state, 1024, WORD_LIGHT_FORMAT), held)
  assert.notEqual(
    traceAtlasFor(state, 1024, WORD_LIGHT_FORMAT),
    held,
    'the last of a full run at a quarter',
  )
})

test('the trace atlas alone is given back where the traced mode is off, the others with it', () => {
  const { state, storage } = emptyAtlases()
  const temp = tempFor(state, storage, { row: 4, probes: 16 })
  traceAtlasFor(state, 100, WORD_LIGHT_FORMAT)
  dropTraceAtlas(state)
  assert.deepEqual([state.temp, state.traceAtlas], [temp, undefined])
  traceAtlasFor(state, 100, WORD_LIGHT_FORMAT)
  dropTemp(state)
  assert.deepEqual([state.temp, state.traceAtlas], [undefined, undefined])
})
