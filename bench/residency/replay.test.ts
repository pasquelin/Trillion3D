// The residency replay (`replay.ts`) on traces written by hand, each the case the design names: a
// streaming tile's ancestor, a tile past the feedback's cap, a shadow pool that holds its pages; and
// a short generated flight through every policy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tileId } from '../../packages/sdk-browser/src/webgpu/tile/ids.ts'
import { heapPolicy, rankPolicy } from './tilePolicies.ts'
import { replayTiles } from './tileReplay.ts'
import { replayVsm } from './vsmReplay.ts'
import { compareTiles, compareVsm, FLIGHTS, tileVerdict, vsmVerdict } from './replay.ts'
import { tileFlight, vsmFlight } from './flight.ts'
import type { TileTrace } from './trace.ts'

const tile = (slot: number, level: number, tx = 0) => tileId({ slot, level, tx, ty: 0 })

/** A trace of `frames`, frame `f` asking `ask(f)` as `[tile, weight]` pairs, in listing order. */
const traceOf = (frames: number, ask: (f: number) => [number, number][]): TileTrace => ({
  name: 'hand',
  tails: Array(64).fill(3),
  frames: Array.from({ length: frames }, (_, f) => ({
    tiles: Uint32Array.from(ask(f).map(([id]) => id)),
    weights: Uint32Array.from(ask(f).map(([, weight]) => weight)),
  })),
})

test('the ancestor a streaming tile reads stays: the heap that hears it not loses it', () => {
  // The ancestor first; then its child streams behind heavier tiles, one new each frame.
  const trace = traceOf(40, (f) =>
    f < 2
      ? [[tile(0, 1), 10]]
      : [
          [tile(0, 0), 1],
          [tile(1 + f, 0), 10],
        ],
  )
  const run = (policy: ReturnType<typeof heapPolicy>) =>
    replayTiles(trace, policy, { places: 3, uploads: 1 }).deficit
  const heap = run(heapPolicy(3, false))
  assert.ok(run(heapPolicy(3, true)) < heap, 'the heap that hears ancestors keeps it')
  assert.ok(run(rankPolicy(3, { name: 'rank' })) < heap, 'the GPU stamp keeps it')
})

test('a tile past the feedback cap, read every frame, stays under the GPU stamp alone', () => {
  // Two heavier tiles fill the capped list every frame; the third is read and never listed.
  const trace = traceOf(40, (f) =>
    f < 2
      ? [[tile(0, 0), 1]]
      : [
          [tile(1 + f, 0), 5],
          [tile(1, 0, 1), 5],
          [tile(0, 0), 1],
        ],
  )
  const run = (policy: ReturnType<typeof heapPolicy>) =>
    replayTiles(trace, policy, { places: 3, cap: 2 }).deficit
  const heap = run(heapPolicy(3, true))
  assert.ok(heap > 0, 'the heap evicts the tile it never hears')
  assert.ok(run(rankPolicy(3, { name: 'rank' })) < heap)
})

test('a shadow pool that holds every page draws each page once, in either order', () => {
  const trace = {
    name: 'hand',
    frames: Array.from({ length: 10 }, () => ({ pages: Uint32Array.of(1, 2, 3) })),
  }
  for (const order of ['lru', 'rank'] as const) {
    const result = replayVsm(trace, order, 3)
    assert.equal(result.missesPerFrame, 3 / 10)
    assert.equal(result.keptPerFrame, 0)
  }
})

test('a short generated flight runs through every policy and every order', () => {
  const flight = { ...FLIGHTS[0], frames: 24, width: 96, height: 54, cuts: [12] }
  const tiles = compareTiles(tileFlight(flight)),
    shadows = compareVsm(vsmFlight(flight))
  assert.equal(tiles.length, 15)
  for (const result of tiles) {
    assert.ok(Number.isFinite(result.deficit) && result.deficit >= 0, result.policy)
    assert.equal(result.converge.length, 1)
  }
  assert.match(tileVerdict(tiles), /^(take rank|take rank fine|keep the heap)$/)
  assert.equal(shadows.length, 6)
  assert.match(vsmVerdict(shadows), /^(take the rank|keep exact young ages)$/)
})
