import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTileAtlas } from './atlas/atlas.ts'
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './page/pageTable.ts'
import { tileLayout } from '../texture/tiles.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { poolEncoding } from '../texture/blockFormats.ts'
import { textureDevice } from './textureDevice.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'

installGpuGlobals()

const empty = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }

// Behaviour: an atlas opens one pool per lane its textures take, each texture's tiles and tail
// in its lane's pool — a lossless chain beside a block one never shares a texture —, the tap of
// its lane in its header, and a lane no texture takes has no pool but a stand-in view.
/** The word of texture `slot`'s header that holds its tail's place and tap. */
const tailWord = (slot: number) => PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS + 3

test('each texture lives in the pool of its lane, and an empty lane has a stand-in', () => {
  const { gpu, destroyed } = textureDevice()
  const layout = tileLayout(4096, 4096)
  const encoding = poolEncoding('bc7')
  const textures = [
    { layout, lane: 'rgba' as const, tap: 1, source: { kind: 'bytes' as const, tail: empty } },
    { layout, lane: 'lossless' as const, tap: 0, source: { kind: 'bytes' as const, tail: empty } },
  ]
  const atlas = createWebgpuTileAtlas(gpu, {
    kind: 'data',
    encoding,
    layers: { lossless: 1, rgba: 2, 'two-channel': 0, hdr: 0 },
    feedbackOffset: 0,
    clock: () => 1,
    textures,
  })
  assert.equal(atlas.pools.length, 2)
  assert.equal(atlas.views.length, 3)
  assert.equal(atlas.views[1], atlas.poolOf(0).view)
  assert.equal(atlas.views[0], atlas.poolOf(1).view)
  assert.notEqual(atlas.views[2], atlas.views[0], 'the two-channel lane: a stand-in')
  atlas.pinTails({ writeTexture() {} } as never, () => {})
  atlas.place({ slot: 0, level: 0, tx: 0, ty: 0 })
  atlas.place({ slot: 1, level: 0, tx: 0, ty: 0 })
  atlas.place({ slot: 1, level: 0, tx: 1, ty: 0 })
  assert.equal(atlas.poolOf(0).resident, 2, 'its tail and one tile')
  assert.equal(atlas.poolOf(1).resident, 3, 'its tail and two tiles')
  assert.equal(atlas.pages.words[tailWord(0)] >>> 24, encoding.tapOf('rgba'))
  assert.equal(atlas.pages.words[tailWord(1)] >>> 24, encoding.tapOf('lossless'))
  assert.deepEqual(atlas.resize(gpu, { lossless: 1, rgba: 1, 'two-channel': 0, hdr: 0 }), {
    evicted: 0,
    replaced: 1,
  })
  destroyRetired(gpu)
  assert.equal(destroyed(), 1, 'only the lane whose layers changed gets a new pool')
  atlas.destroy()
  assert.equal(destroyed(), 4, 'both pools and the stand-in')
})

// A texture appended after open takes a lane no texture took — the resize opens its pool —
// with its tail pinned there and a new views tuple, so every group naming the atlas is rebuilt;
// the tiles held stay where they were.
test('an appended texture opens its lane, pins its tail there and hands out new views', () => {
  const { gpu } = textureDevice()
  const layout = tileLayout(4096, 4096),
    queue = { writeTexture() {} } as never
  const texture = (lane: 'rgba' | 'two-channel') => ({
    layout,
    lane,
    tap: lane === 'rgba' ? 1 : 2,
    source: { kind: 'bytes' as const, tail: empty },
  })
  const atlas = createWebgpuTileAtlas(gpu, {
    kind: 'data',
    encoding: poolEncoding('bc7'),
    layers: { lossless: 0, rgba: 1, 'two-channel': 0, hdr: 0 },
    feedbackOffset: 0,
    clock: () => 1,
    textures: [texture('rgba')],
  })
  atlas.pinTails(queue, () => {})
  atlas.place({ slot: 0, level: 0, tx: 0, ty: 0 })
  const views = atlas.views,
    held = atlas.pages.entryOf({ slot: 0, level: 0, tx: 0, ty: 0 })
  assert.equal(atlas.resize(gpu, { lossless: 0, rgba: 1, 'two-channel': 1, hdr: 0 }).replaced, 1)
  assert.equal(atlas.append(texture('two-channel')), 1)
  atlas.pinTails(queue, () => {}, 1)
  assert.notEqual(atlas.views, views, 'a new tuple: the groups are rebuilt')
  assert.equal(atlas.views[2], atlas.poolOf(1).view, 'the two-channel lane has its pool')
  assert.deepEqual([atlas.poolOf(0).resident, atlas.poolOf(1).resident], [2, 1])
  assert.equal(atlas.pages.entryOf({ slot: 0, level: 0, tx: 0, ty: 0 }), held)
  assert.equal(atlas.pages.words[1], 2)
  atlas.destroy()
})

// An atlas whose only texture is the white fill takes no layer: the fill reads the
// stand-in, written opaque white — every tap of its one texel read white in its pool —, until a
// map opens its lane, where the fill then takes its place first.
test('the white fill alone takes no pool, reads the white stand-in, and joins its lane once opened', () => {
  const { device, textureWrites } = fakeDevice()
  const encoding = poolEncoding(undefined),
    fill = { layout: tileLayout(1, 1), lane: 'lossless' as const, tap: 0 }
  const atlas = createWebgpuTileAtlas(device, {
    kind: 'color',
    encoding,
    layers: { lossless: 0, rgba: 0, 'two-channel': 0, hdr: 0 },
    feedbackOffset: 0,
    clock: () => 1,
    textures: [{ ...fill, source: { kind: 'bytes' as const, tail: encoding.whiteOf('lossless') } }],
  })
  assert.equal(atlas.pools.length, 0, 'no layer')
  assert.deepEqual([...(textureWrites[0].data as Uint8Array)], new Array(64).fill(255))
  atlas.pinTails(device.queue, () => {})
  assert.equal(
    atlas.pages.words[tailWord(0)] >>> 24,
    encoding.tapOf('lossless'),
    'the stand-in lane',
  )
  assert.equal(atlas.residentIn('lossless'), 0)
  atlas.resize(device, { lossless: 1, rgba: 0, 'two-channel': 0, hdr: 0 })
  assert.deepEqual(atlas.poolOf(0).occupied(), [0], 'the fill pinned first in the opened lane')
  assert.equal(textureWrites.length, 2, 'its white texel written there')
  // Its last map released, a budget gives the lane no layer: the fill reads the stand-in again.
  atlas.resize(device, { lossless: 0, rgba: 0, 'two-channel': 0, hdr: 0 })
  assert.equal(atlas.pools.length, 0, 'the lane closed with the fill in it')
  assert.equal(atlas.residentIn('lossless'), 0)
  atlas.destroy()
})

// Behaviour: the colour atlas binds its half-float pool where the data atlas binds its two-channel
// one — the same three bindings, the sampled textures of a stage within WebGPU's sixteen —: a
// half-float chain lives in the third pool, in `rgba16float`, its header carrying the half-float
// tap, and a colour atlas without one keeps a stand-in there.
test('the colour atlas holds its half-float lane in its third binding', () => {
  const { gpu } = textureDevice()
  const layout = tileLayout(4096, 4096)
  const encoding = poolEncoding('bc7')
  const textures = [
    { layout, lane: 'hdr' as const, tap: 4, source: { kind: 'bytes' as const, tail: empty } },
    { layout, lane: 'rgba' as const, tap: 1, source: { kind: 'bytes' as const, tail: empty } },
  ]
  const atlas = createWebgpuTileAtlas(gpu, {
    kind: 'color',
    encoding,
    layers: { lossless: 0, rgba: 1, 'two-channel': 0, hdr: 1 },
    feedbackOffset: 0,
    clock: () => 1,
    textures,
  })
  assert.equal(atlas.views.length, 3)
  assert.equal(atlas.views[2], atlas.poolOf(0).view, 'half-float: the third binding')
  assert.equal(atlas.views[1], atlas.poolOf(1).view)
  assert.equal(atlas.pools.length, 2, 'no lossless pool opened')
  assert.equal(atlas.poolOf(0).texture.format, 'rgba16float')
  atlas.pinTails({ writeTexture() {} } as never, () => {})
  assert.equal(atlas.pages.words[tailWord(0)] >>> 24, encoding.tapOf('hdr'))
  assert.equal(encoding.tapOf('hdr'), 4)
  atlas.destroy()
})
