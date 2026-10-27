// The radiance cache's ray end word, with the level that covers a point, and the cache's tile addressing.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { CACHE_WORDS_WGSL } from './cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

test('a ray’s end keeps its distance in a half float, whether it met a surface, which side of it and the share of it that left the scene, and the level that covers a point is the first whose probes hold it, the fade starting at the cube’s outermost probes', () => {
  const levels = [1, 2, 4, 8].map((spacing) => ({ base: [-24, -24, -24], spacing }))
  const kit = shaderRun<{
    cacheDepthWord: (
      distance: number,
      hit: boolean,
      sky: number,
      front: boolean,
      twoSided: boolean,
    ) => number
    cacheDepthOf: (word: number) => number
    cacheHitIs: (word: number) => boolean
    cacheFrontIs: (word: number) => boolean
    cacheTwoSidedIs: (word: number) => boolean
    cacheSkyOf: (word: number) => number
    cacheTileOf: (slot: number, resolution: number) => number[]
    cacheCoverage: (
      P: number[],
      random: number,
    ) => { level: number; valid: boolean; minTrace: number }
  }>(
    wgslModule(bounceBindingsWgsl(0, 0, 1), CACHE_WORDS_WGSL),
    [
      'cacheDepthWord',
      'cacheDepthOf',
      'cacheHitIs',
      'cacheFrontIs',
      'cacheTwoSidedIs',
      'cacheSkyOf',
      'cacheTileOf',
      'cacheCoverage',
    ],
    { bounce: { reach: [200, 1, 0, 0], counts: [48, 4, 110592, 16384], levels }, cellTable: {} },
  )
  const word = kit.cacheDepthWord(12.5, true, 0.5, true, false)
  assert.deepEqual([kit.cacheDepthOf(word), kit.cacheHitIs(word)], [12.5, true])
  assert.ok(Math.abs(kit.cacheSkyOf(word) - 0.5) < 1 / 255)
  // The low half is a probe's depth: the half float with its sign bit the facing and its last bit the two-sidedness, all ones for a miss.
  assert.equal(word & 0xffff, (0x4a40 & 0x7ffe) | 0x8000)
  assert.equal(kit.cacheDepthWord(12.5, true, 0, false, true) & 0xffff, 0x4a40 | 1)
  assert.deepEqual(
    [word, kit.cacheDepthWord(12.5, true, 0, false, true)].map((w) => [
      kit.cacheFrontIs(w),
      kit.cacheTwoSidedIs(w),
    ]),
    [
      [true, false],
      [false, true],
    ],
  )
  const back = kit.cacheDepthWord(12.5, true, 0, false, false)
  assert.deepEqual(
    [kit.cacheHitIs(back), kit.cacheFrontIs(back), kit.cacheTwoSidedIs(back)],
    [true, false, false],
    'a hit that neither faces the ray nor is two-sided: the back of a one-sided surface',
  )
  const missed = kit.cacheDepthWord(200, false, 1, false, false)
  assert.equal(missed & 0xffff, 0xffff)
  assert.deepEqual(
    [
      kit.cacheHitIs(missed),
      kit.cacheSkyOf(missed),
      kit.cacheFrontIs(missed),
      kit.cacheTwoSidedIs(missed),
    ],
    [false, 1, true, true],
  )
  assert.ok(
    Math.abs(kit.cacheDepthOf(missed) - 655.03) < 1e-3,
    'no hit: 65503 centimetres, one hundredth of a metre under the half float’s largest',
  )
  assert.equal(
    kit.cacheDepthOf(kit.cacheDepthWord(1e6, true, 0, true, false)) <= 655.04,
    true,
    'held to the half float',
  )
  // The slot's map in the pool's rows: a row of 128.
  assert.deepEqual(kit.cacheTileOf(130, 16), [32, 16])
  const inside = kit.cacheCoverage([0.2, 0.3, 0.1], 0)
  assert.deepEqual([inside.level, inside.valid], [0, true])
  assert.ok(
    Math.abs(inside.minTrace - 2 * Math.sqrt(3)) < 1e-6,
    'the nearest a ray starts and the diagonal again',
  )
  assert.equal(
    kit.cacheCoverage([23.1, 0, 0], 0).level,
    1,
    'past the last probe of the finest level, half a cell inside its edge, the next answers',
  )
  assert.deepEqual(
    [kit.cacheCoverage([100, 0, 0], 0).level, kit.cacheCoverage([1000, 0, 0], 0).valid],
    [3, false],
  )
  // With a number past zero a level answers only where the fade at its edge (a cell's width, from the last probe, half a cell inside, to the one before) is past it:
  // at 22.7 the finest level's fade is 0.3, not past a half; at 22.5 it is a half, not past it; at 22.1 it is 0.9.
  assert.deepEqual(
    [22.7, 22.5, 22.1].map((x) => kit.cacheCoverage([x, 0, 0], 0.5).level),
    [1, 1, 0],
  )
  assert.deepEqual(
    [22.7, 22.5, 22.1].map((x) => kit.cacheCoverage([x, 0, 0], 0).level),
    [0, 0, 0],
  )
  // The scale of the nearest a ray starts at is the cache's own (`reach.y` of the levels' uniform): a cache whose cells march nothing starts them
  // a tenth of the diagonal from the probe.
  const near = shaderRun<{ cacheCoverage: (P: number[], random: number) => { minTrace: number } }>(
    wgslModule(bounceBindingsWgsl(0, 0, 1), CACHE_WORDS_WGSL),
    ['cacheCoverage'],
    { bounce: { reach: [200, 0.1, 0, 0], counts: [48, 4, 110592, 16384], levels }, cellTable: {} },
  )
  assert.ok(Math.abs(near.cacheCoverage([0.2, 0.3, 0.1], 0).minTrace - 1.1 * Math.sqrt(3)) < 1e-5)
})
