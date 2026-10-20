// What a shrink of the tile pool does to the tiles it holds past its surviving layers: a resident
// tile moved takes the finer entries it served to its new place, not the old one, which the new
// pool no longer holds; an evicted one is told to its texture; a pinned tail keeps a place.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTilePool } from '../pool/pool.ts'
import { resizeTileAtlas } from './atlasResize.ts'
import { createWebgpuTilePageTable } from '../page/pageTable.ts'
import { tailId, tileId } from '../ids.ts'
import { packEntry, tileLayout, TILES_PER_LAYER } from '../../texture/tiles.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { textureDevice } from '../textureDevice.fixture.ts'

installGpuGlobals()

const options = { kind: 'color', lane: 'lossless', format: 'rgba8unorm', texelBytes: 4 } as const

test('a tile moved by a shrink takes the finer entries it served to its new place', () => {
  const { gpu } = textureDevice()
  const pool = createWebgpuTilePool(gpu, { ...options, layers: 2 })
  const pages = createWebgpuTilePageTable(gpu, [tileLayout(512, 512)], {
    kind: 'color',
    feedbackOffset: 0,
  })
  const coarse = { slot: 0, level: 1, tx: 1, ty: 0 },
    fine = { slot: 0, level: 0, tx: 2, ty: 1 },
    id = tileId(coarse)
  pool.adopt(TILES_PER_LAYER, id)
  pages.setTile(coarse, pool.placeOf(TILES_PER_LAYER))
  pages.setTile(fine, { x: 3, y: 0, layer: 0 })
  const resident = new Map([[id, TILES_PER_LAYER]])
  const { pool: next } = resizeTileAtlas(gpu, { ...options, layers: 1 }, 0, pool, pages, resident)
  const moved = packEntry(next.placeOf(resident.get(id)!), 1)
  assert.equal(pages.entryOf(coarse), moved)
  // Level 0 under it: the finer tile at 2,1 stays; the three it served follow it.
  const finer = packEntry({ x: 3, y: 0, layer: 0 }, 0)
  for (let ty = 0; ty < 2; ty++)
    for (let tx = 2; tx < 4; tx++)
      assert.equal(pages.entryOf({ ...fine, tx, ty }), tx === 2 && ty === 1 ? finer : moved)
})

// Behaviour: a shrink tells each texture it evicts a tile of, for whoever reads it to
// follow; a tail it would displace, which only a pool drawn under its floor holds, refuses by name.
test('a shrink tells the texture of each tile it evicts, and never clears a tail as a tile', () => {
  const { gpu } = textureDevice()
  const cleared: number[] = []
  const pages = {
    setTail() {},
    setTile() {},
    clearTile: (key: { tx: number }) => cleared.push(key.tx),
  }
  const pool = createWebgpuTilePool(gpu, { ...options, layers: 2 })
  const resident = new Map<number, number>()
  for (let index = 0; index < TILES_PER_LAYER + 2; index++) {
    const id = tileId({
      slot: index < TILES_PER_LAYER ? 0 : 1,
      level: 0,
      tx: index % 256,
      ty: index >> 8,
    })
    pool.adopt(index, id)
    resident.set(id, index)
  }
  const heard: number[] = []
  const shrunk = { ...options, layers: 1 }
  const result = resizeTileAtlas(gpu, shrunk, 0, pool, pages as never, resident, (slot) =>
    heard.push(slot),
  )
  assert.deepEqual(heard, [1, 1], 'the texture of each tile evicted hears it')
  assert.equal(result.evicted, 2)
  assert.equal(cleared.length, 2)
  assert.equal(resident.size, TILES_PER_LAYER)
  const under = createWebgpuTilePool(gpu, { ...options, layers: 2 })
  for (let slot = 0; slot <= TILES_PER_LAYER; slot++) under.adopt(slot, tailId(slot))
  assert.throws(
    () => resizeTileAtlas(gpu, shrunk, 0, under, pages as never, new Map()),
    /TEXTURE_POOL_UNDER_FLOOR/,
  )
  assert.equal(cleared.length, 2, 'no tail cleared')
})

test('a tail pinned past the surviving layers keeps its place: a streamed tile there gives way', () => {
  const { gpu } = textureDevice()
  const cleared: number[] = [],
    tails: number[] = []
  const pages = {
    setTail: (slot: number) => tails.push(slot),
    setTile() {},
    clearTile: (key: { tx: number }) => cleared.push(key.tx),
  }
  // The surviving layer full of streamed tiles, one read of late; a tail pinned later, in layer 1.
  const pool = createWebgpuTilePool(gpu, { ...options, layers: 2 })
  const resident = new Map<number, number>()
  for (let index = 0; index < TILES_PER_LAYER; index++) {
    const id = tileId({ slot: 0, level: 0, tx: index % 256, ty: index >> 8 })
    pool.adopt(index, id)
    resident.set(id, index)
  }
  pool.follow(Uint32Array.of(1, 7), pool.arrivals)
  pool.adopt(TILES_PER_LAYER, tailId(3))
  resident.set(tailId(3), TILES_PER_LAYER)
  const result = resizeTileAtlas(gpu, { ...options, layers: 1 }, 0, pool, pages as never, resident)
  assert.equal(result.evicted, 1, 'one streamed tile gives way')
  assert.deepEqual(cleared, [7], 'the first victim of the queue')
  assert.deepEqual(tails, [3], 'the tail moved into the place it left')
  assert.equal(resident.get(tailId(3)), 7)
  assert.equal(result.pool.pinnedOf(7), true)
})
