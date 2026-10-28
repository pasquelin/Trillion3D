// A pass lands at most 32 tiles, whatever its byte and millisecond budgets; a barrier lifts it; a
// pass that changed the colour atlas says so once, a write that failed after its place was taken
// or another's given up included.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTilePump } from './pump.ts'
import { createTileCounters } from './counters.ts'
import { createFrameBudget } from '../../geometry/integration/frameBudget.ts'
import type { TileRequest } from './requests.ts'
import { texturesPending } from '../../lighting/surfaceCache/capture/objectTextures.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'

/** A pump over `count` requests that every serve lands, or, under `serving`, serves as it says: the
 *  tiles it landed, by their order, how many times it said a colour tile landed and the atlas's
 *  evictions. */
function pumpOf(
  count: number,
  serving?: (tx: number, atlas: { evictions: number }, landed: Set<number>) => string,
  level = 2,
) {
  const landed = new Set<number>(),
    failed: string[] = [],
    said = { colour: 0 }
  const atlas = {
    kind: 'color' as const,
    // Texture 1 has three tile levels below its tail: level 2 is its coarsest.
    textures: { 1: { layout: { tail: 3 } } },
    evictions: 0,
    resides: ({ tx }: { tx: number }) => landed.has(tx),
    poolOf: () => ({ tileBytes: 1 }),
  }
  const list = Array.from({ length: count }, (_, tx) => ({
    atlas,
    key: { slot: 1, level, tx, ty: 0 },
    weight: 1,
  })) as unknown as TileRequest[]
  const wanted = { list, from: 0, to: count }
  const requests = {
    frame: 1,
    askedCount: 0,
    asked: [],
    take: () => wanted,
    clearAsked() {},
    defer: (from: number) => void (wanted.from = Math.min(from, wanted.to)),
    get deferred() {
      return wanted.to - wanted.from
    },
  }
  const sources = {
    serve: (_: unknown, key: { tx: number }) => {
      if (serving) return serving(key.tx, atlas, landed)
      landed.add(key.tx)
      return 'served'
    },
    endPass() {},
  }
  const counters = createTileCounters()
  const pump = createTilePump({
    device: { createCommandEncoder: () => ({}) },
    clock: createFrameBudget(Infinity, { now: () => 0 }),
    budgetMs: 1e6,
    budgetBytes: Number.MAX_SAFE_INTEGER,
    color: atlas,
    sources,
    requests,
    counters,
    residency: { follow() {} },
    flushAll() {},
    onFailure: (phase: string, error: unknown) => {
      if (!serving) assert.fail(`${phase}: ${String(error)}`)
      failed.push(phase)
    },
    onColorChanged: () => void said.colour++,
  } as unknown as Parameters<typeof createTilePump>[0])
  return { pump, landed, said, failed, counters }
}

test('a pass lands 32 tiles at most, the rest waiting for the next', () => {
  const { pump, landed } = pumpOf(40)
  assert.deepEqual(pump(1), { served: 32, pending: 8 })
  assert.equal(landed.size, 32)
  assert.deepEqual(pump(2), { served: 8, pending: 0 })
  assert.equal(landed.size, 40)
})

test('a barrier pass lifts the count', () => {
  const { pump, landed } = pumpOf(40)
  assert.deepEqual(pump(1, true), { served: 40, pending: 0 })
  assert.equal(landed.size, 40)
})

test('a pass that landed colour tiles says so once, however many, and one that landed none says nothing', () => {
  const { pump, said } = pumpOf(40)
  pump(1)
  assert.equal(said.colour, 1, '32 tiles, one signal')
  pump(2)
  assert.equal(said.colour, 2, 'the next pass landed 8 more')
  pump(3)
  assert.equal(said.colour, 2, 'nothing left to land: no signal')
})

test('a pass says the colour atlas changed when a write failed after its place was taken', () => {
  const { pump, said, failed } = pumpOf(1, (tx, _, landed) => {
    landed.add(tx)
    throw new Error('write failed')
  })
  pump(1)
  assert.deepEqual(failed, ['texture-tile-failed'])
  assert.equal(said.colour, 1)
})

test('a tile whose source fails is no longer waited for: nothing of its texture is pending, so a still view is not held on it for good', () => {
  const { pump, counters, failed } = pumpOf(1, () => {
    throw new Error('source failed')
  })
  assert.deepEqual(pump(1), { served: 0, pending: 0 })
  assert.deepEqual(failed, ['texture-tile-failed'])
  assert.equal(counters.coarseMissing('color', 1), false)
})

test('a pass says the colour atlas changed when a tile was evicted and no place followed', () => {
  const { pump, said } = pumpOf(1, (_, atlas) => {
    atlas.evictions++
    return 'refused'
  })
  pump(1)
  assert.equal(said.colour, 1)
})

test('a pass that changed nothing in the colour atlas says nothing', () => {
  const { pump, said } = pumpOf(1, () => 'waiting')
  pump(1)
  assert.equal(said.colour, 0)
})

test('the pending tiles are told by texture: the pass that leaves tiles of a texture pending marks it, the pass that lands them clears it', () => {
  const { pump, counters } = pumpOf(40)
  pump(1)
  assert.equal(
    counters.coarseMissing('color', 1),
    true,
    'eight tiles of texture 1 wait: the texture is pending',
  )
  assert.equal(counters.coarseMissing('color', 2), false, 'another texture asked nothing')
  assert.equal(
    counters.coarseMissing('data', 1),
    false,
    'the slot of another atlas is another texture',
  )
  pump(2)
  assert.equal(counters.coarseMissing('color', 1), false)
})

test('a tile whose bytes are awaited marks its texture pending too', () => {
  const { pump, counters } = pumpOf(3, () => 'waiting')
  assert.deepEqual(pump(1), { served: 0, pending: 3 })
  assert.equal(counters.coarseMissing('color', 1), true)
})

test('an object is captured once the coarse level of the textures its surface wears is whole, not before: held while one is pending, ready the pass they land, and still so after', () => {
  const { pump, counters } = pumpOf(40)
  const map = {} as Texture,
    normalMap = {} as Texture,
    other = {} as Texture
  const slots = {
    mapLayer: new Map<Texture, number>([
      [map, 1],
      [other, 2],
    ]),
    dataLayer: new Map<Texture, number>([[normalMap, 1]]),
  }
  const waits = (surface: object) => texturesPending(counters, slots, surface)
  pump(1)
  assert.equal(waits({ map }), true, 'its colour map has tiles pending: held')
  assert.equal(
    waits({ map: other }),
    false,
    'an object whose textures are whole is captured at once',
  )
  assert.equal(
    waits({ normalMap }),
    false,
    'slot 1 of the data atlas is not slot 1 of the colour atlas',
  )
  assert.equal(waits({}), false, 'a surface with no map is never held')
  assert.equal(
    waits({ map: {} as Texture }),
    false,
    'a texture the atlas holds no slot of is not pending',
  )
  pump(2)
  assert.equal(waits({ map }), false, 'the textures landed: captured, and so for every image after')
  pump(3)
  assert.equal(waits({ map }), false)
})

test('the tiles of a finer level than the coarsest are pending for the view but hold no object back, and the light waits for the coarse ones alone', () => {
  const { pump, counters } = pumpOf(40, undefined, 0)
  const map = {} as Texture
  const slots = {
    mapLayer: new Map<Texture, number>([[map, 1]]),
    dataLayer: new Map<Texture, number>(),
  }
  pump(1)
  assert.equal(counters.pending, 8, 'eight tiles wait')
  assert.equal(counters.pendingCoarse, 0, 'none at the coarsest level')
  assert.equal(
    texturesPending(counters, slots, { map }),
    false,
    'the cards read the coarse level: the object is captured',
  )
  const coarse = pumpOf(40, undefined, 2)
  coarse.pump(1)
  assert.equal(coarse.counters.pendingCoarse, 8)
  assert.equal(texturesPending(coarse.counters, slots, { map }), true)
})

test('a surface’s textures are listed once while it is not written', () => {
  const { counters } = pumpOf(1)
  const map = {} as Texture
  const slots = {
    mapLayer: new Map<Texture, number>([[map, 1]]),
    dataLayer: new Map<Texture, number>(),
  }
  let reads = 0
  const surface = { version: 1, map, graph: { readTextures: () => (reads++, [] as Texture[]) } }
  texturesPending(counters, slots, surface)
  texturesPending(counters, slots, surface)
  texturesPending(counters, slots, surface)
  assert.equal(reads, 1, 'listed once for the three asks')
  surface.version = 2
  texturesPending(counters, slots, surface)
  assert.equal(reads, 2, 'listed again once the surface was written')
})
