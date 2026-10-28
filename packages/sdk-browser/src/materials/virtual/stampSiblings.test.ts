// A pixel names one pick of its material's maps; the stamp of the place that pick reads extends to the places
// its siblings — the maps read at the same coordinates — read at the same place of the image (`stampWgsl.ts`,
// `stacks.ts`), a sibling of another size at the level its size puts it at, as the reference's page holds every
// layer of a stack and aligns them by a mip bias. Run on the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { TILE_STAMP_WGSL } from './stampWgsl.ts'
import { TILE_PLACE_WORD_WGSL } from './slotUse.ts'
import { createWebgpuTilePageTable, SIBLING_DATA, siblingWord } from './page/pageTable.ts'
import { sizeBias } from './stacks.ts'
import { tileLayout, TILES_PER_ROW } from '../texture/tiles.ts'
import { placeIndex } from '../texture/tiles.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { TileKey } from './page/pageTable.ts'

const { tilePlaceWord } = shaderRun<{ tilePlaceWord: (base: number, index: number) => number }>(
  TILE_PLACE_WORD_WGSL,
  ['tilePlaceWord'],
  {},
)

/** Two atlases: colour textures 1 and 2 of 4096², 3 of 2048², 4 of 4096² holding nothing; data texture 1 of 4096². */
function scene() {
  const { device } = fakeDevice()
  const big = tileLayout(4096, 4096),
    small = tileLayout(2048, 2048)
  const table = (
    kind: 'color' | 'data',
    layouts: ReturnType<typeof tileLayout>[],
    offset: number,
  ) => createWebgpuTilePageTable(device, layouts, { kind, feedbackOffset: offset })
  const colorPages = table('color', [tileLayout(1, 1), big, big, small, big], 0)
  const dataPages = table('data', [tileLayout(1, 1), big], colorPages.entries)
  // The stack of colour texture 1: colour 2, colour 3 (half its size), colour 4 (nothing resident), data 1.
  const word = (ref: number, other: ReturnType<typeof tileLayout>) =>
    siblingWord(ref, sizeBias(4096, 4096, other.width, other.height))
  colorPages.setSiblings(1, [
    word(2, big),
    word(3, small),
    word(4, big),
    word(1 | SIBLING_DATA, big),
  ])
  colorPages.setSiblings(3, [siblingWord(1, sizeBias(2048, 2048, 4096, 4096))])
  const use = { color: new Array<number>(8192).fill(0), data: new Array<number>(8192).fill(0) }
  /** Makes `key` resident at the pool index `index` of its atlas. */
  const hold = (kind: 'color' | 'data', key: TileKey, index: number) => {
    const place = { x: index % TILES_PER_ROW, y: Math.floor(index / TILES_PER_ROW), layer: 0 }
    assert.equal(placeIndex(place), index)
    ;(kind === 'color' ? colorPages : dataPages).setTile(key, place)
  }
  /** The stamp of the rank of `key` in the colour atlas at `clock`: what the reduction does for it. */
  const stamp = (key: TileKey, clock: number) => {
    const { tileStampRank } = shaderRun<{ tileStampRank: (rank: number, clock: number) => void }>(
      TILE_STAMP_WGSL,
      ['tileStampRank'],
      {
        colorPages: colorPages.words,
        dataPages: dataPages.words,
        colorUse: use.color,
        dataUse: use.data,
      },
    )
    tileStampRank(colorPages.feedbackIndexOf(key), clock)
  }
  /** The clock the place at pool index `index` of an atlas was last used at. */
  const clockOf = (kind: 'color' | 'data', index: number) => use[kind][tilePlaceWord(0, index)]
  return { hold, stamp, clockOf, use }
}

test('a stamp on one map stamps the resident places of its siblings at the same level and tile, at the same clock', () => {
  const { hold, stamp, clockOf } = scene()
  const tile = { level: 0, tx: 3, ty: 2 }
  hold('color', { slot: 1, ...tile }, 10)
  hold('color', { slot: 2, ...tile }, 20)
  hold('data', { slot: 1, ...tile }, 30)
  stamp({ slot: 1, ...tile }, 7)
  assert.equal(clockOf('color', 10), 7, 'the pick it names')
  assert.equal(clockOf('color', 20), 7, 'a sibling of the colour atlas')
  assert.equal(clockOf('data', 30), 7, 'a sibling of the data atlas')
})

test('a sibling with no tile there is asked of nobody: only the places that were resident move', () => {
  const { hold, stamp, clockOf, use } = scene()
  const tile = { level: 1, tx: 1, ty: 0 }
  hold('color', { slot: 1, ...tile }, 10)
  stamp({ slot: 1, ...tile }, 9)
  assert.equal(clockOf('color', 10), 9)
  // Colour 2 and 4 and data 1 hold nothing there, colour 3 holds nothing: one word moved.
  const moved = [...use.color, ...use.data].filter((word) => word !== 0)
  assert.equal(moved.length, 1)
})

test('a sibling of half the size is stamped one level finer down, at the same tile of the image', () => {
  const { hold, stamp, clockOf } = scene()
  // 4096² level 2 is 1024²: 4 tiles a side; 2048² level 1 is 1024² too, the same 4 tiles a side.
  hold('color', { slot: 1, level: 2, tx: 3, ty: 1 }, 10)
  hold('color', { slot: 3, level: 1, tx: 3, ty: 1 }, 40)
  hold('color', { slot: 3, level: 2, tx: 3, ty: 1 }, 41)
  stamp({ slot: 1, level: 2, tx: 3, ty: 1 }, 6)
  assert.equal(clockOf('color', 40), 6, 'the level its size puts it at')
  assert.equal(clockOf('color', 41), 0, 'not the same level number')
})

test('a sibling of half the size, read at its finest, is stamped at the tile that covers the same image', () => {
  const { hold, stamp, clockOf } = scene()
  // 4096² level 0 has no level of 2048² to match: the finest of it, whose tile covers 2 x 2 of the pixel's.
  hold('color', { slot: 1, level: 0, tx: 5, ty: 3 }, 10)
  hold('color', { slot: 3, level: 0, tx: 2, ty: 1 }, 40)
  hold('color', { slot: 3, level: 0, tx: 5, ty: 3 }, 41)
  stamp({ slot: 1, level: 0, tx: 5, ty: 3 }, 8)
  assert.equal(clockOf('color', 40), 8, 'its tile of the same region')
  assert.equal(clockOf('color', 41), 0, 'not the tile of the same index')
})

test('a sibling of twice the size is stamped at its coarser level, the same tile', () => {
  const { hold, stamp, clockOf } = scene()
  // Texture 3 (2048²) lists colour 1 (4096²): its level 1 is read at level 2 of the large one.
  hold('color', { slot: 3, level: 1, tx: 2, ty: 1 }, 40)
  hold('color', { slot: 1, level: 2, tx: 2, ty: 1 }, 10)
  stamp({ slot: 3, level: 1, tx: 2, ty: 1 }, 4)
  assert.equal(clockOf('color', 40), 4)
})

test('the siblings of a tile of a coarser level are the tiles of that level', () => {
  const { hold, stamp, clockOf } = scene()
  hold('color', { slot: 1, level: 2, tx: 1, ty: 1 }, 10)
  hold('color', { slot: 2, level: 2, tx: 1, ty: 1 }, 20)
  hold('color', { slot: 2, level: 0, tx: 1, ty: 1 }, 21)
  stamp({ slot: 1, level: 2, tx: 1, ty: 1 }, 5)
  assert.equal(clockOf('color', 20), 5, 'its tile of that level')
  assert.equal(clockOf('color', 21), 0, 'not its tile of another level')
})
