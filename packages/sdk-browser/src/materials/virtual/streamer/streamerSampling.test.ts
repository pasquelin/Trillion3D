// A texture's sampling follows its record, not the surfaces that wear it — the records written
// since the last render visited, before the hold verdict, then the headers written where a word
// moved, whichever pass reads the texture —, and a moved texture is signalled as a landed
// tile is, so a held image is released.
import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTileStreamer } from './streamer.ts'
import { createFrameBudget } from '../../../geometry/integration/frameBudget.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { tileLayout } from '../../texture/tiles.ts'
import { SAMPLE_ANISOTROPY_SHIFT, SAMPLE_ONE_READ } from '../../texture/sampling.ts'
import { PAGE_FILTER_SHIFT, SLOT_FILTER_WORD, slotHeader } from '../page/pageTable.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from '../../../frame/loop/hold.ts'
import { drawFinalImage, settledRt } from '../../../frame/loop/hold.fixture.ts'
import * as G from '../../../scene/host/graph/graph.fixture.ts'

installGpuGlobals()

/** The filtering a streamer is opened with: one object, as the session's getter keeps it. */
const FILTERING = { ceiling: MAX_ANISOTROPY, taps: true }
const DEFAULT_FILTERING = () => FILTERING

/** A host texture at the default read — its filter word zero: linear, mipped, one tap. */
const host = () => {
  const texture = G.dataTexture(new Uint8Array(4), 1, 1)
  texture.magFilter = 'linear'
  texture.minFilter = 'linearMipLinear'
  texture.anisotropy = 1
  return texture
}

/** A streamer over one colour and one data texture, both whole in their tail; counts the page
 *  table writes and the signals. */
function streamer(
  colours: Texture[],
  data: Texture,
  onColour = () => {},
  filtering = DEFAULT_FILTERING,
) {
  const signalled = { count: 0 }
  const { device, writes } = fakeDevice(BACKEND)
  const blocks = { bc7: [], astc: [], etc2: [] }
  const whole = (texture?: Texture) => ({
    layout: tileLayout(1, 1),
    lane: 'lossless' as const,
    tap: 0,
    source: { kind: 'bytes' as const, tail: { levels: [new Uint8Array(4)], blocks } },
    texture,
  })
  const lossless = { lossless: 2, rgba: 0, 'two-channel': 0, hdr: 0 }
  const textures = createWebgpuTileStreamer({
    device,
    color: [whole(), ...colours.map(whole)],
    data: [whole(), whole(data)],
    layers: { color: lossless, data: lossless },
    encoding: poolEncoding(undefined),
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs: Number.MAX_SAFE_INTEGER,
    clock: createFrameBudget(Infinity),
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    filtering,
    onColorChanged: () => {
      signalled.count++
      onColour()
    },
  })
  textures.prepare()
  const tableWrites = () =>
    writes.filter((write) => write.buffer.label?.startsWith('Trillion3D texture pages')).length
  return { textures, writes: tableWrites, signalled }
}

/** One image's follow, as `../../../frame/render/render.ts` runs it before the hold verdict: the
 *  records written since the last image are in the streamer's journal, by their own writes. */
const follow = async (textures: { followSampling(): boolean }) => {
  await Promise.resolve()
  return textures.followSampling()
}

test('the headers follow their hosts at each render, only what moved written', async () => {
  const colour = host(),
    data = host()
  const colourRecord = colour
  const { textures, writes, signalled } = streamer([colourRecord], data)
  const opened = writes()
  await follow(textures)
  assert.equal(writes(), opened, 'nothing moved: nothing written')
  // A host sets either order as often as the other: `needsUpdate` first, the filter after it.
  colour.needsUpdate = true
  colour.minFilter = 'nearestMipNearest'
  colour.anisotropy = 8
  await follow(textures)
  assert.equal(colourRecord.minFilter, 'nearestMipNearest', 'the filter written after it')
  assert.equal(signalled.count, 1, 'signalled as a landed tile is')
  assert.equal(writes(), opened + 1)
  await follow(textures)
  assert.equal(writes(), opened + 1, 'the same state: written once')
  // A placement moves no version: the matrix recomposed at the write moves the header.
  data.offset.x = 0.5
  await follow(textures)
  assert.equal(signalled.count, 2, 'a data header written is signalled too')
  assert.equal(writes(), opened + 2, 'one send per atlas that moved')
  // An addressing rides in the header too: written, and the cutout shadows told, as a filter.
  colour.wrapS = 'clamp'
  await follow(textures)
  assert.equal(signalled.count, 3, 'an addressing is signalled as a filter is')
  assert.equal(writes(), opened + 3)
  textures.destroy()
})

// Two engines hold the same record. Each keeps the counters it wrote its header
// at: the second to follow in the image learns the change the first brought up.
test('two engines over the same texture both write the change', async () => {
  const colour = host()
  const shared = colour
  const first = streamer([shared], host()),
    second = streamer([shared], host())
  const opened = [first.writes(), second.writes()]
  colour.magFilter = 'nearest'
  assert.equal(await follow(first.textures), true, 'a filter rule switched on')
  assert.equal(second.textures.followSampling(), true, 'the second engine learns it too')
  assert.deepEqual([first.writes(), second.writes()], [opened[0] + 1, opened[1] + 1])
  assert.deepEqual([first.signalled.count, second.signalled.count], [1, 1])
  colour.magFilter = 'linear'
  assert.equal(await follow(first.textures), true, 'switched off: the pages change class')
  colour.wrapS = 'clamp'
  assert.equal(await follow(first.textures), false, 'an addressing switches no filter rule')
  first.textures.destroy()
  second.textures.destroy()
})

test('the map of a transparent surface alone follows its host, no surface reread', async () => {
  const map = host()
  const surface = G.standardSurface({ transparent: true, opacity: 0.5, map })
  const read = surface.map!
  const { textures, signalled } = streamer([read], host())
  map.magFilter = 'nearest'
  map.wrapT = 'mirror'
  await follow(textures)
  assert.deepEqual([read.magFilter, read.wrapT], ['nearest', 'mirror'], 'the item’s record')
  assert.equal(signalled.count, 1)
  textures.destroy()
})

test('a filter changed on a held image releases it, and the image draws it', async () => {
  const colour = host()
  const rt = settledRt()
  const { textures } = streamer([colour], host(), () => rt.run.gate.resourcesChanged())
  const { device } = fakeDevice(BACKEND)
  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  await follow(textures)
  drawFinalImage(rt, device)
  assert.equal(holdWebgpuFrame(rt, device), true, 'nothing moved: the image is held')
  colour.magFilter = 'nearest'
  await follow(textures)
  assert.equal(holdWebgpuFrame(rt, device), false, 'the next image is drawn')
  textures.destroy()
})

// The follow walked every slot and read every host at every image, held or not.
test('a still image reads no record and walks no slot', async () => {
  const colour = host()
  const { textures, writes } = streamer([colour], host())
  await follow(textures)
  const opened = writes()
  let reads = 0
  const { magFilter } = colour
  Object.defineProperty(colour, 'magFilter', {
    get: () => (reads++, magFilter),
    configurable: true,
  })
  for (let image = 0; image < 3; image++) await follow(textures)
  assert.equal(reads, 0, 'nothing written: nothing read')
  colour.anisotropy = 1
  await follow(textures)
  assert.ok(reads > 0, 'a written record is read at the next image')
  assert.equal(writes(), opened, 'and nothing moved: nothing written')
  textures.destroy()
})

/** The anisotropy a texture's header of the colour atlas holds: the reads its sampling word allows. */
const grantedReads = (textures: { color: { pages: { words: Uint32Array } } }, slot: number) => {
  const word = textures.color.pages.words[slotHeader(slot) + SLOT_FILTER_WORD] >>> PAGE_FILTER_SHIFT
  return ((word >>> SAMPLE_ANISOTROPY_SHIFT) & 15) + 1
}

/** A filtering the test moves: the same object until it is set, as the session's getter keeps it. */
function movable(ceiling: number, taps = true) {
  let held = { ceiling, taps }
  return {
    get: () => held,
    set: (next: Partial<typeof held>) => (held = { ...held, ...next }),
  }
}

test('a header holds the texture’s anisotropy under the ceiling, and a moved ceiling writes it again', async () => {
  const colour = host()
  colour.anisotropy = 16
  const filtering = movable(8)
  const { textures, writes, signalled } = streamer([colour], host(), undefined, filtering.get)
  assert.equal(grantedReads(textures, 1), 8, 'a texture asking 16 is held to the ceiling')
  const opened = writes()
  await follow(textures)
  assert.equal(writes(), opened, 'the same ceiling: nothing written')
  filtering.set({ ceiling: 4 })
  assert.equal(await follow(textures), false, 'a filter rule moved, not switched')
  assert.equal(grantedReads(textures, 1), 4)
  assert.equal(writes(), opened + 1)
  assert.equal(signalled.count, 1, 'signalled as a landed tile is')
  await follow(textures)
  assert.equal(writes(), opened + 1, 'written once')
  filtering.set({ ceiling: 16 })
  await follow(textures)
  assert.equal(grantedReads(textures, 1), 16, 'raised: the texture’s own again')
  textures.destroy()
})

test('a texture that asks less keeps its own anisotropy under any ceiling', async () => {
  const colour = host()
  colour.anisotropy = 2
  const { textures } = streamer([colour], host(), undefined, movable(8).get)
  assert.equal(grantedReads(textures, 1), 2)
  textures.destroy()
})

test('a ceiling of one leaves the texture one tap: its filter rule is the default read', async () => {
  const colour = host()
  colour.anisotropy = 16
  const filtering = movable(8)
  const { textures } = streamer([colour], host(), undefined, filtering.get)
  filtering.set({ ceiling: 1 })
  assert.equal(await follow(textures), true, 'the word is zero: the pages change resolve class')
  assert.equal(grantedReads(textures, 1), 1)
  textures.destroy()
})

test('the one read switch writes every header again, and the word carries it', async () => {
  const colour = host()
  const filtering = movable(8, true)
  const { textures, writes } = streamer([colour], host(), undefined, filtering.get)
  const word = () =>
    textures.color.pages.words[slotHeader(1) + SLOT_FILTER_WORD] >>> PAGE_FILTER_SHIFT
  assert.equal(word() & SAMPLE_ONE_READ, 0, 'taps on: the read as before')
  const opened = writes()
  filtering.set({ taps: false })
  assert.equal(await follow(textures), true, 'a page read once is read through the filter rule')
  assert.equal(word() & SAMPLE_ONE_READ, SAMPLE_ONE_READ)
  assert.equal(writes(), opened + 2, 'one send per atlas')
  await follow(textures)
  assert.equal(writes(), opened + 2, 'written once')
  textures.destroy()
})
