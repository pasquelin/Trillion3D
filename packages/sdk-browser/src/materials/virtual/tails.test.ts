import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTileAtlas } from './atlas/atlas.ts'
import { tailId } from './ids.ts'
import { tileLayout, TILES_PER_LAYER } from '../texture/tiles.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { poolEncoding } from '../texture/blockFormats.ts'
import { textureDevice } from './textureDevice.fixture.ts'

installGpuGlobals()

const empty = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }
const raw = () => ({
  layout: tileLayout(4096, 4096),
  lane: 'lossless' as const,
  source: { kind: 'bytes' as const, tail: empty },
})

test('a tail pinned late into a pool its streamed tiles fill takes the place one gives up', () => {
  const { gpu } = textureDevice()
  const atlas = createWebgpuTileAtlas(gpu, {
    kind: 'color',
    encoding: poolEncoding(undefined),
    layers: { lossless: 1, rgba: 0, 'two-channel': 0 },
    feedbackOffset: 0,
    clock: () => 1,
    textures: [raw(), raw()],
  })
  // Slot 0's tail, then its streamed tiles till the pool is full: no queue lists a victim yet.
  atlas.pinTails({ writeTexture() {} } as never, () => {}, 0, 1)
  for (let i = 0; i < 2 * TILES_PER_LAYER; i++)
    atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) })
  assert.equal(atlas.pools[0].resident, TILES_PER_LAYER, 'full')
  let written = 0
  atlas.pinTail(1, () => written++)
  assert.equal(written, 1)
  assert.equal(atlas.tailPinned(1), true)
  assert.equal(atlas.evictions, 1, 'one streamed tile gave its place up')
  assert.equal(
    atlas.pools[0].pinnedOf(
      atlas.pools[0].occupied().find((p) => atlas.pools[0].keyOf(p) === tailId(1))!,
    ),
    true,
  )
})
