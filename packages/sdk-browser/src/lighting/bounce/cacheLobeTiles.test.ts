// The radiance cache's tiles cut by the lobes the screen probes want light in.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { CACHE_TILES_PROGRAM } from './cache/cacheTilesWgsl.ts'
import { CACHE_PDF_UNITS, CACHE_PDF_WORDS } from './cache/cacheLayout.ts'

const WORDS = CACHE_PDF_WORDS

/** The tiles `cacheLobeTiles` lists for a probe whose lobes are `mean` (the nine means), to `levels` levels, a map of `resolution` texels. */
function tilesOf(mean: number[], levels: number, resolution = 32, threshold = 0.1) {
  const memory = new Int32Array(WORDS * 2)
  // The weight is a count of one, the coefficients are in the units the screen probes add them in.
  mean.forEach((value, k) => (memory[WORDS + k] = Math.trunc(value * CACHE_PDF_UNITS)))
  memory[WORDS + 9] = 1
  const entries: number[][] = []
  const kit = shaderRun<{
    cacheLobeTiles: (entry: number, slot: number, levels: number, lane: number) => void
  }>(CACHE_TILES_PROGRAM, ['cacheLobeTiles'], {
    cache: { resolution, tileThreshold: threshold },
    cacheTiles: { x: 0, y: 0, one: 1, count: 0, entries },
    arrayLength: () => 1e6,
    lobes: memory,
    atomicLoad: (p: { get: () => number }) => p.get(),
  })
  for (let lane = 0; lane < 64; lane++) kit.cacheLobeTiles(0, 1, levels, lane)
  return entries.map((e) => ({ level: e[0] >> 16, x: e[1] & 0xffff, y: e[1] >> 16 }))
}

test('without lobes every tile stays at the first level; with them the tiles they weigh are cut, as far as the levels allow', () => {
  const none = tilesOf(new Array(9).fill(0), 3)
  assert.equal(none.length, 4)
  assert.ok(none.every((t) => t.level === 0))
  // The constant term alone weighs every direction: every first tile is cut once (the threshold past it keeps the second level whole)...
  const flat = [1, 0, 0, 0, 0, 0, 0, 0, 0]
  assert.equal(tilesOf(flat, 2).length, 16)
  // ... and a weight above the threshold goes down to the third level where the levels are three.
  assert.equal(tilesOf(flat, 3).length, 64)
  // One level: nothing is cut, whatever the lobes.
  assert.equal(tilesOf(flat, 1).length, 4)
  // A threshold above the weight stops at the second level.
  assert.equal(tilesOf(flat, 3, 32, 100).length, 16)
})
