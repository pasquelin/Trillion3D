// A tile still streaming is drawn by the finest resident ancestor its entry names: the pixels read
// that place, so the feedback that names the missing tile keeps the ancestor in use (`atlas.ts`,
// `touch`). The old rule touched the asked tile alone, and a full pool evicted the very ancestor the
// image was sampling: a coarser level shown for frames.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTileAtlas } from './atlas.ts'
import { entryIndex, packEntry, placeOf, tileLayout, TILES_PER_LAYER } from '../../texture/tiles.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { textureDevice } from './textureDevice.fixture.ts'

installGpuGlobals()

const empty = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }

test('an entry names its place back: the pool index of every place', () => {
  for (const index of [0, 1, 29, 30, 899, 900, 4095 * TILES_PER_LAYER + 899])
    assert.equal(entryIndex(packEntry(placeOf(index), 3)), index)
})

test('the ancestor a streaming tile reads is never the victim while the tile is asked', () => {
  const { gpu } = textureDevice()
  const atlas = createWebgpuTileAtlas(gpu, {
    kind: 'color',
    encoding: poolEncoding(undefined),
    layers: { lossless: 1, rgba: 0, 'two-channel': 0 },
    feedbackOffset: 0,
    textures: [
      {
        layout: tileLayout(4096, 4096),
        lane: 'lossless',
        source: { kind: 'bytes', tail: empty },
      },
    ],
  })
  atlas.pinTails({ writeTexture() {} } as never, () => {})
  const ancestor = { slot: 0, level: 1, tx: 0, ty: 0 },
    child = { slot: 0, level: 0, tx: 0, ty: 0 }
  assert.ok(atlas.place(ancestor, 1))
  assert.equal(atlas.servedLevel(child), 1, 'the child reads its ancestor')
  // The child is asked every frame and streams: its pixels sample the ancestor.
  for (let frame = 2; frame <= 6; frame++) assert.equal(atlas.touch(child, frame), false)
  // A full pool at frame 6: every other tile of level 0 asked, more than its 900 places.
  for (let i = 1; i < 1024; i++)
    atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) }, 6)
  assert.equal(atlas.servedLevel(child), 1, 'the ancestor still serves the child')
  assert.equal(atlas.touch(ancestor, 7), true, 'the ancestor is resident')
})
