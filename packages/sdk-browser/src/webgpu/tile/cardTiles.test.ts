// An impostor card's maps are textures of the one tile pool (#1527): a card is ready only once
// every tile of the levels it reads resides in all three maps and their tails — level files of their
// own — are pinned; a card not drawn posts no feedback, so what it waits for the CPU asks, and the
// pool serves it as any tile, each once; a card that waits hears what lands. Fails on the old code:
// the maps were three textures of their own per mesh, outside the pool.
import test from 'node:test'
import assert from 'node:assert/strict'
import { previewLevelSize } from '../../../../sdk-core/src/index.ts'
import { createWebgpuTileStreamer } from './streamer.ts'
import { createFrameBudget } from '../../page/integration/frameBudget.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { tileLayout } from '../../texture/tiles.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createPageCache } from '../../streaming/pageCache.ts'
import type { TextureLevelRequest } from '../../texture/levelReader.ts'
import type { CardTiles } from './cardTiles.ts'

/** A 256² map of three levels — 256, 128, 64 —, as a bake that stops at frames of four texels
 *  writes it: two streamed levels of four and one tile, its tail the 64² level. */
const SIDE = 256,
  LEVELS = 3
const mapOf = (name: string) => ({
  layout: tileLayout(SIDE, SIDE, LEVELS),
  lane: 'lossless' as const,
  source: {
    kind: 'files' as const,
    levels: Array.from({ length: LEVELS }, (_, level) => ({
      url: `${name}${level}.png`,
      sha256: `${name}${level}`.padEnd(64, '0'),
    })),
  },
})

function cardStreamer() {
  const { device, imageCopies } = fakeDevice()
  const blocks = { bc7: [], astc: [], etc2: [] }
  const fill = {
    layout: tileLayout(1, 1),
    lane: 'lossless' as const,
    source: { kind: 'bytes' as const, tail: { levels: [new Uint8Array(4)], blocks } },
  }
  const read: string[] = []
  let landed = 0
  const lossless = { lossless: 1, rgba: 0, 'two-channel': 0 }
  const tiles: CardTiles = [1, 1, 2]
  const textures = createWebgpuTileStreamer({
    device,
    color: [fill, mapOf('c')],
    data: [fill, mapOf('n'), mapOf('o')],
    layers: { color: lossless, data: lossless },
    encoding: poolEncoding(undefined),
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs: Number.MAX_SAFE_INTEGER,
    clock: createFrameBudget(Infinity),
    readLevel: Object.assign(
      async ({ level, url }: TextureLevelRequest) => {
        read.push(url!)
        const [width, height] = previewLevelSize(SIDE, SIDE, level)
        return { width, height, close() {} } as ImageBitmap
      },
      { store: createPageCache(), key: 'k' },
    ),
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged: () => {},
    cards: new Map([[7, tiles]]),
    onCardsLanded: () => void landed++,
  })
  textures.prepare()
  return { textures, tiles, imageCopies, read, landed: () => landed }
}

test('a card is ready once every tile it reads resides in its three maps and their tails are pinned', async () => {
  const { textures, tiles, imageCopies, read, landed } = cardStreamer()
  const { cards } = textures
  assert.equal(cards.count, 1)
  assert.deepEqual(cards.tilesOf(7), tiles)
  assert.equal(cards.tilesOf(8), undefined, 'a mesh the catalogue does not hold')
  const ask = { from: 0, to: 1, pixels: 160 }
  let passes = 0
  while (!cards.ready(tiles, ask)) {
    assert.ok(++passes <= 6, 'ready within a few passes')
    textures.pump(passes)
    await textures.settled()
  }
  // Each of the three maps: four level-0 tiles and one level-1 tile, then its tail, once each.
  assert.equal(imageCopies.length, 3 * (4 + 1) + 3, 'every tile and tail copied once')
  assert.equal(new Set(read).size, read.length, 'each level file read once')
  assert.deepEqual(
    read.toSorted(),
    ['c0', 'c1', 'c2', 'n0', 'n1', 'n2', 'o0', 'o1', 'o2'].map((n) => `${n}.png`),
  )
  assert.ok(landed() >= 1, 'a card that waits hears what lands')
  // Ready, it asks nothing more: the next pass copies nothing.
  textures.pump(passes + 1)
  assert.equal(imageCopies.length, 18)
})

test('a card that reads a level the pool lacks waits, its finer tiles asked, nothing else served', async () => {
  const { textures, tiles, imageCopies } = cardStreamer()
  const { cards } = textures
  // Far: the second level and the tail alone.
  for (let pass = 1; !cards.ready(tiles, { from: 1, to: 2, pixels: 16 }); pass++) {
    assert.ok(pass <= 6)
    textures.pump(pass)
    await textures.settled()
  }
  assert.equal(imageCopies.length, 3 * 1 + 3, 'one tile and the tail a map')
  // Nearer: level 0 is read now, which the pool lacks — not ready until it lands.
  const near = { from: 0, to: 1, pixels: 160 }
  assert.equal(cards.ready(tiles, near), false)
  for (let pass = 10; !cards.ready(tiles, near); pass++) {
    assert.ok(pass <= 16)
    textures.pump(pass)
    await textures.settled()
  }
  assert.equal(imageCopies.length, 3 * 5 + 3, 'its level-0 tiles added, nothing copied twice')
})
