// The tile pools' eviction on the GPU (#1527): the feedback reduction stamps the place each asked
// tile's entry names — the ancestor a streaming tile's pixels read, a tile past the list's cap —,
// and the pool's queue, ranked on those stamps, never names a place read of late. The old CPU heap
// touched only the tiles the capped list named: a tile past the cap, sampled every frame, was
// evicted while the image read it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTileAtlas } from './atlas.ts'
import { createTileEvictions } from './evictSort.ts'
import { entryIndex, reduceRequests, stampedPlace } from './stamp.fixture.ts'
import { REDUCE_WGSL } from './reduceWgsl.ts'
import { TILE_USE_HEADER } from './slotUse.ts'
import { tileId } from './ids.ts'
import { packEntry, placeOf, tileLayout, TILES_PER_LAYER } from '../../texture/tiles.ts'
import { laneCounts, poolEncoding } from '../../texture/blockFormats.ts'
import { textureProbe } from '../residency/poolGrants.ts'
import { texturePoolFor } from '../residency/memoryBudgets.ts'
import { noTails } from '../../texture/noTails.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { words } from '../../../../../tests/kit/gpu/fakeBuffers.ts'
import { createWebgpuTilePageTable, type TileKey } from './pageTable.ts'

const empty = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }

/** One 4096² texture in one lossless layer — 900 places, its tail pinned —, at clock `now.clock`. */
function scene() {
  const { device } = fakeDevice()
  const now = { clock: 1 }
  const atlas = createWebgpuTileAtlas(device, {
    kind: 'color',
    encoding: poolEncoding(undefined),
    layers: { lossless: 1, rgba: 0, 'two-channel': 0 },
    feedbackOffset: 0,
    textures: [
      { layout: tileLayout(4096, 4096), lane: 'lossless', source: { kind: 'bytes', tail: empty } },
    ],
    clock: () => now.clock,
  })
  atlas.pinTails({ writeTexture() {} } as never, () => {})
  const evictions = createTileEvictions(device)
  /** One image at `now.clock`: the pixels asking `asked` stamp what they read (`stampWgsl.ts`),
   *  then the queue is cut and read back into the pool. */
  const frame = (asked: readonly TileKey[]) => {
    atlas.flush(device)
    const use = words((atlas.slotUse.buffer as unknown as { data: Uint8Array }).data)
    for (const key of asked) {
      const read = stampedPlace(atlas.pages.words, atlas.pages.feedbackIndexOf(key))
      if (!read) continue
      const at = TILE_USE_HEADER + 2 * (use[read.lane] + read.index)
      use[at] = Math.max(use[at], now.clock)
    }
    const cut = evictions.encode(device.createCommandEncoder(), [atlas], now.clock)
    cut?.read(words((cut.buffer as unknown as { data: Uint8Array }).data))
    now.clock++
  }
  const level0 = (i: number) => ({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) })
  return { atlas, frame, level0, pool: atlas.pools[0] }
}

test('a stamp finds the texture of its entry, an all-tail texture between two streamed ones included', () => {
  const { device } = fakeDevice()
  // Slot 1 streams nothing: its level-0 start is its base all the same, the starts climb.
  const layouts = [tileLayout(2048, 1024), tileLayout(1, 1), tileLayout(512, 512)]
  const table = createWebgpuTilePageTable(device, layouts, { kind: 'data', feedbackOffset: 0 })
  const taps = [1, 0, 3]
  taps.forEach((tap, slot) => table.setTail(slot, placeOf(slot), tap))
  const keys = [
    { slot: 0, level: 0, tx: 0, ty: 0 },
    { slot: 0, level: 4, tx: 0, ty: 0 },
    { slot: 2, level: 0, tx: 3, ty: 3 },
    { slot: 2, level: 2, tx: 0, ty: 0 },
  ]
  keys.forEach((key, i) => table.setTile(key, placeOf(100 + i)))
  keys.forEach((key, i) =>
    assert.deepEqual(stampedPlace(table.words, table.feedbackIndexOf(key)), {
      lane: Math.min(taps[key.slot], 2),
      index: 100 + i,
    }),
  )
})

test('the ancestor a streaming tile reads is stamped, and never the victim while the tile is asked', () => {
  const { atlas, frame, level0, pool } = scene()
  const ancestor = { slot: 0, level: 1, tx: 0, ty: 0 },
    child = level0(0)
  const place = atlas.place(ancestor)!
  assert.equal(atlas.servedLevel(child), 1, 'the child reads its ancestor')
  const read = stampedPlace(atlas.pages.words, atlas.pages.feedbackIndexOf(child))
  assert.deepEqual(read, { lane: 0, index: entryIndex(packEntry(place, 1)) })
  // Every other place of the layer holds a level-0 tile no pixel reads any more.
  for (let i = 1; pool.resident < pool.tiles; i++) atlas.place(level0(i))
  // The child is asked frame after frame and streams: only its ancestor is read.
  for (let f = 0; f < 6; f++) frame([child])
  const victims: number[] = []
  for (let index = pool.victim(); index !== undefined; index = pool.victim()) {
    victims.push(index)
    pool.release(index)
  }
  assert.equal(victims.length, pool.tiles - 2, 'every place but the tail and the ancestor')
  assert.ok(!victims.includes(read!.index), 'the ancestor stays')
  assert.equal(atlas.resides(ancestor), true)
})

test('a tile past the feedback cap, read every frame, is stamped and stays resident', () => {
  // The reduction stamps before the cap: the kernel's order, and its mirror's.
  assert.ok(REDUCE_WGSL.indexOf('tileStampRank(rank') < REDUCE_WGSL.indexOf('if(at<uni.cap)'))
  const { atlas, frame, level0, pool } = scene()
  for (let i = 0; pool.resident < pool.tiles; i++) atlas.place(level0(i))
  // A view reading the first 600 tiles, a list of 16 entries: 584 of them never listed.
  const seen = Array.from({ length: 600 }, (_, i) => level0(i))
  const stamped: number[] = []
  const listed = reduceRequests(
    seen.map((key) => atlas.pages.feedbackIndexOf(key) + 1),
    16,
    (rank) => stamped.push(rank),
  )
  assert.equal(listed.length, 16)
  assert.equal(stamped.length, 600, 'every rank stamped, listed or not')
  for (let f = 0; f < 6; f++) frame(seen)
  const victims = new Set<number>()
  for (let index = pool.victim(); index !== undefined; index = pool.victim()) {
    victims.add(index)
    pool.release(index)
  }
  assert.equal(victims.size, pool.tiles - 1 - 600, 'only the tiles no pixel reads')
  for (const key of seen) assert.equal(atlas.resides(key), true)
})

// A card waiting for its maps posts no feedback, and one drawn may not read every level it needs:
// the CPU pins the tiles its mesh holds (`cardTiles.ts`) once, never again an image, so a full pool
// never gives them up and turns the card back to its clusters; let go, they rank as arrivals. Old
// code: the CPU stamped each of them every image, a write per tile per image.
test('under a full pool, the tiles a card holds are never victims, and rank again once let go', () => {
  const { atlas, frame, level0, pool } = scene()
  const held: TileKey[] = []
  for (let i = 0; pool.resident < pool.tiles; i++) atlas.place((held[i] = level0(i)))
  const card = Array.from({ length: 50 }, (_, i) => tileId(level0(100 + i)))
  for (const id of card) assert.equal(atlas.pin(id, true), true)
  const changed = pool.changed.count
  // No pixel reads them, and nothing is written for them image after image.
  for (let f = 0; f < 6; f++) frame([])
  assert.ok(changed > 0)
  assert.equal(pool.changed.count, 0, 'held: no word written again')
  // An arrival takes the first victim's place, its tile given up by the atlas as the engine does.
  assert.ok(atlas.place({ slot: 0, level: 1, tx: 0, ty: 0 }))
  const given = held.filter((key) => !atlas.resides(key))
  assert.equal(given.length, 1)
  assert.equal(atlas.pin(tileId(given[0]), true), false, 'a tile given up is not pinned')
  const victims = new Set<number>()
  for (let index = pool.victim(); index !== undefined; index = pool.victim()) {
    victims.add(index)
    pool.release(index)
  }
  assert.equal(victims.size, pool.tiles - 2 - card.length, 'every other place but the tail')
  for (const id of card) assert.equal(atlas.pin(id, false), true, 'let go, still resident')
  for (let f = 0; f < 6; f++) frame([])
  let ranked = 0
  for (let index = pool.victim(); index !== undefined; index = pool.victim()) {
    ranked++
    pool.release(index)
  }
  assert.equal(ranked, card.length + 1, 'let go, each a victim again, beside the arrival')
})

// The place words are GPU memory made with the pools: the probe that asks the device for a pool
// asks for them too, at the size the atlas makes them, so a resize after it creates nothing the
// device or the ledger has not admitted. Old code: the probe asked for the textures alone.
test('a texture probe asks for the place words of each atlas, as the atlas makes them', () => {
  const { device, buffers } = fakeDevice()
  const encoding = poolEncoding(undefined),
    lanes = { ...laneCounts(), lossless: 2 * TILES_PER_LAYER }
  const pool = texturePoolFor(
    1 << 30,
    undefined,
    { color: lanes, data: lanes },
    encoding.texelBytes,
    noTails,
  )
  assert.equal(pool.layers.color.lossless, 2)
  textureProbe(device, encoding)(pool)
  const probed = buffers.filter(({ label }) => label === 'Trillion3D pool probe')
  const { atlas } = scene()
  const made = (layers: number) => (atlas.slotUse.buffer.size / 4 - TILE_USE_HEADER) * layers * 4
  assert.deepEqual(
    probed.map(({ size }) => size),
    [0, 0].map(() => TILE_USE_HEADER * 4 + made(2)),
  )
})
