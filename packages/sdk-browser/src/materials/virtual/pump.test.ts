// A pass lands at most 32 tiles, whatever its byte and millisecond budgets; a barrier lifts it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTilePump } from './pump.ts'
import { createTileCounters } from './counters.ts'
import { createFrameBudget } from '../../geometry/integration/frameBudget.ts'
import type { TileRequest } from './requests.ts'

/** A pump over `count` requests that every serve lands: the tiles it landed, by their order. */
function pumpOf(count: number) {
  const landed = new Set<number>()
  const atlas = {
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
    colorChanged: new Set<number>(),
    sources,
    requests,
    counters: createTileCounters(),
    residency: { follow() {} },
    flushAll() {},
    onFailure: (phase: string, error: unknown) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged() {},
  } as unknown as Parameters<typeof createTilePump>[0])
  return { pump, landed }
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
