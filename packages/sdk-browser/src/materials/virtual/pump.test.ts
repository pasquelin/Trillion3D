// A pass lands at most 32 tiles, whatever its byte and millisecond budgets; a barrier lifts it; a
// pass that changed the colour atlas says so once, a write that failed after its place was taken
// or another's given up included.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTilePump } from './pump.ts'
import { createTileCounters } from './counters.ts'
import { createFrameBudget } from '../../geometry/integration/frameBudget.ts'
import type { TileRequest } from './requests.ts'

/** A pump over `count` requests that every serve lands, or, under `serving`, serves as it says: the
 *  tiles it landed, by their order, how many times it said a colour tile landed and the atlas's
 *  evictions. */
function pumpOf(
  count: number,
  serving?: (tx: number, atlas: { evictions: number }, landed: Set<number>) => string,
) {
  const landed = new Set<number>(),
    failed: string[] = [],
    said = { colour: 0 }
  const atlas = {
    evictions: 0,
    resides: ({ tx }: { tx: number }) => landed.has(tx),
    poolOf: () => ({ tileBytes: 1 }),
  }
  const list = Array.from({ length: count }, (_, tx) => ({
    atlas,
    key: { slot: 1, level: 0, tx, ty: 0 },
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
  const pump = createTilePump({
    device: { createCommandEncoder: () => ({}) },
    clock: createFrameBudget(Infinity, { now: () => 0 }),
    budgetMs: 1e6,
    budgetBytes: Number.MAX_SAFE_INTEGER,
    color: atlas,
    sources,
    requests,
    counters: createTileCounters(),
    residency: { follow() {} },
    flushAll() {},
    onFailure: (phase: string, error: unknown) => {
      if (!serving) assert.fail(`${phase}: ${String(error)}`)
      failed.push(phase)
    },
    onColorChanged: () => void said.colour++,
  } as unknown as Parameters<typeof createTilePump>[0])
  return { pump, landed, said, failed }
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
