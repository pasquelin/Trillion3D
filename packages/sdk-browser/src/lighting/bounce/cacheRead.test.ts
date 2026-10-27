// The screen probes' read of the radiance cache.

import test from 'node:test'
import assert from 'node:assert/strict'
import { ATLAS_CALLS, CORNER_CELLS, cellProbes, oneLevel } from './atlas.fixture.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { CACHE_WORDS_WGSL } from './cache/cacheWordsWgsl.ts'
import { spCacheRead, type CacheGatherScope } from './screen/cacheReadWgsl.ts'
import { SCREEN_PROBE_FLAGS } from './screen/screenProbeLayout.ts'
import { packLight } from '../../gpu/core/smallFloatWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

/** The cache's depth word and the light word, run on the shipped text. */
function wordKits() {
  return {
    words: shaderRun<{
      cacheDepthWord: (
        distance: number,
        hit: boolean,
        sky: number,
        front: boolean,
        twoSided: boolean,
      ) => number
    }>(wgslModule(bounceBindingsWgsl(0, 0, 1), CACHE_WORDS_WGSL), ['cacheDepthWord'], {
      bounce: {},
      cellTable: {},
    }),
    light: shaderRun<{ packLight: (c: number[]) => number }>(
      wgslModule(packLight),
      ['packLight'],
      {},
    ),
  }
}

/** The world's probes round the point `(0.3, 0.4, 0.2)` of the finest level — the cells of the cube beside it, a slot each —,
 *  their table made, and the cache's maps simulated: every texel of the final map of probe `k` the light `(k + 1, 0, 0)`,
 *  the raw ones a ray that went `20` metres, `sky` of it left the scene. `valid` names the probes the table publishes (a probe is published at
 *  its first trace; the others' cells name none). The maps keep their light
 *  multiplied by `preExposure` (`bounce.reach.z`, and its inverse `reach.w`, the uniform's). */
function cacheScene(
  valid: boolean[],
  mips: number,
  sky = 0,
  scope: CacheGatherScope = 'workgroup',
  preExposure = 1,
) {
  const cache = { res: 16, side: 48 }
  // A probe not published is a hole in the list, which `cellProbes` skips: the slots of the others keep their rank.
  const published = [...CORNER_CELLS]
  valid.forEach((made, k) => made || delete published[k])
  const atlas = cellProbes(published)
  const { words, light } = wordKits()
  const loads: number[] = []
  const slots: number[] = []
  // A probe's final map is the map and its border all round, `1 << (mips - 1)` texels at the first level, halved at each level of detail.
  const finalSide = (level: number) => (cache.res + 2 * (1 << (mips - 1))) >> level
  const slotOf = (at: number[], side: number) =>
    Math.floor(at[0] / side) + 128 * Math.floor(at[1] / side)
  const finalMap = {
    load: (at: number[], level: number) => (
      loads.push(level),
      slots.push(slotOf(at, finalSide(level))),
      [light.packLight([(slotOf(at, finalSide(level)) + 1) * preExposure, 0, 0]), 0, 0, 0]
    ),
  }
  const rawMap = { load: () => [0, words.cacheDepthWord(20, true, sky, true, false), 0, 0] }
  const skyMap = {
    load: (at: number[]) => (slots.push(slotOf(at, finalSide(0))), [sky, 0, 0, 0]),
  }
  const run = (flags: number, size: number, copy = false, bias = 0, direction = [0, 0, 1]) => {
    const globals = {
      bounce: {
        ...oneLevel(cache.side),
        reach: [...oneLevel(cache.side).reach.slice(0, 2), preExposure, 1 / preExposure],
      },
      sp: { cache: [1.5, cache.res, mips, 0], mode: [0, 0, flags, 0], spatial: [0, 0, 0, 200] },
      cellTable: atlas,
      cacheFinal: finalMap,
      cacheRaw: rawMap,
      cacheSky: skyMap,
      // A sky light shines: a ray that leaves the scene reaches its cube, `(2, 3, 4)` every way.
      skyLightApplied: () => true,
      skyLightRay: () => [2, 3, 4],
      directLights: { atmosphere: Array.from({ length: 4 }, () => [0, 0, 0, 0]) },
      cacheNow: {
        corner: Array<number>(8).fill(0),
        place: Array.from({ length: 8 }, () => [0, 0, 0]),
        alpha: [0, 0, 0],
        levelHeld: 0,
      },
      textureLoad: (t: unknown, at: number[], a: number, b?: number) =>
        t === atlas
          ? ATLAS_CALLS.textureLoad(atlas, at, a)
          : (t as typeof finalMap).load(at, a ?? b ?? 0),
    }
    const kit = shaderRun<{
      spCacheGather: (P: number[], lane: number) => void
      spCacheGatherOwn: (P: number[]) => void
      spCacheGatherOwnBiased: (P: number[], bias: number, random: number) => void
      spCacheCopy: () => void
      spCacheSample: (
        P: number[],
        d: number[],
        size: number,
      ) => { radiance: number[]; distance: number; sky: number }
    }>(
      wgslModule(
        bounceBindingsWgsl(0, 0, 1),
        spCommon([4, 2]),
        spCacheRead(2, 3, 4, scope),
        // A pass that shares the gather among threads copies the whole struct and back.
        wgslBlock(
          'cacheCopyTest',
          [],
          'fn spCacheCopy(){let held=cacheNow;cacheNow=CacheGathered();cacheNow=held;}',
        ),
      ),
      [
        ...(scope === 'workgroup'
          ? ['spCacheGather']
          : ['spCacheGatherOwn', 'spCacheGatherOwnBiased']),
        'spCacheCopy',
        'spCacheSample',
      ],
      globals,
    )
    const P = [0.3, 0.4, 0.2]
    if (scope === 'workgroup') for (let lane = 0; lane < 8; lane++) kit.spCacheGather(P, lane)
    else if (bias) kit.spCacheGatherOwnBiased(P, bias, 0)
    else kit.spCacheGatherOwn(P)
    if (copy) kit.spCacheCopy()
    loads.length = 0
    slots.length = 0
    return { sample: kit.spCacheSample(P, direction, size), loads: [...loads], slots: [...slots] }
  }
  return { run }
}

test('a ray reads the cache by the eight probes round its point, each at its trilinear share, none where the table publishes none, the level of detail its cone asks, and the sky where it is kept apart', () => {
  const alpha = [0.3, 0.4, 0.2],
    share = (k: number) =>
      alpha.reduce((product, a, axis) => product * ((k >> axis) & 1 ? a : 1 - a), 1)
  const whole = cacheScene(Array(8).fill(true), 1).run(0, 16).sample
  assert.ok(Math.abs(whole.distance - 20) < 1e-3, `every probe went 20 m: ${whole.distance}`)
  // The probe at corner 5 is not published to the table: it gives nothing, its share of the point is lost.
  const missing = cacheScene([true, true, true, true, true, false, true, true], 1).run(0, 16).sample
  assert.ok(Math.abs(missing.distance - 20 * (1 - share(5))) < 1e-3, `${missing.distance}`)
  assert.deepEqual(cacheScene(Array(8).fill(false), 1).run(0, 16).sample.radiance, [0, 0, 0])
  // A cone of the grid's own width reads the first level; a cone four texels of a map of sixteen the second but one, where
  // the map has them, the first where it has one alone.
  assert.deepEqual([...new Set(cacheScene(Array(8).fill(true), 3).run(0, 16).loads)], [0])
  assert.deepEqual([...new Set(cacheScene(Array(8).fill(true), 3).run(0, 8).loads)], [1])
  assert.deepEqual([...new Set(cacheScene(Array(8).fill(true), 3).run(0, 4).loads)], [2])
  assert.deepEqual([...new Set(cacheScene(Array(8).fill(true), 1).run(0, 4).loads)], [0])
  // The sky kept apart: half of every probe's rays left the scene, the light is mixed with the sky itself by that share.
  const apart = cacheScene(Array(8).fill(true), 1, 0.5)
  const own = apart.run(0, 16).sample
  const filled = apart.run(SCREEN_PROBE_FLAGS.cacheSky, 16).sample
  filled.radiance.forEach((c, i) =>
    assert.ok(Math.abs(c - (own.radiance[i] * 0.5 + [2, 3, 4][i] * 0.5)) < 1e-3, `${i}`),
  )
})

test('a thread gathering the probes for its own ray (private scope) samples the same as the workgroup scope, and the whole-struct copy round-trips', () => {
  const all = Array(8).fill(true)
  const partial = [true, true, false, true, true, true, true, true]
  for (const [valid, sky] of [
    [all, 0],
    [partial, 0],
    [all, 0.5],
  ] as const) {
    const flags = sky ? SCREEN_PROBE_FLAGS.cacheSky : 0
    const shared = cacheScene([...valid], 3, sky).run(flags, 8)
    const own = cacheScene([...valid], 3, sky, 'private').run(flags, 8)
    assert.deepEqual(own.sample, shared.sample)
    assert.deepEqual(own.loads, shared.loads)
    assert.deepEqual(
      cacheScene([...valid], 3, sky, 'private').run(flags, 8, true).sample,
      shared.sample,
    )
  }
})

test('the biased private gather clamps to the coarsest level: on a cache of one level it gathers as the unbiased one', () => {
  const plain = cacheScene(Array(8).fill(true), 3, 0, 'private').run(0, 8, false, 0).sample
  const biased = cacheScene(Array(8).fill(true), 3, 0, 'private').run(0, 8, false, 2).sample
  assert.deepEqual(biased, plain)
})

test('a read takes the light out of the pre-exposure the maps keep it under: maps holding it at a sixteenth give the light of maps that hold it as it is', () => {
  const plain = cacheScene(Array(8).fill(true), 1).run(0, 16).sample
  const exposed = cacheScene(Array(8).fill(true), 1, 0, 'workgroup', 1 / 16).run(0, 16).sample
  assert.ok(plain.radiance[0]! > 1)
  assert.deepEqual(exposed.radiance, plain.radiance)
})

test('the read has no per-probe tag: a probe is read by the slot the table publishes for its cell, and the cache binds three maps', () => {
  const read = spCacheRead(0, 1, 2).text
  assert.doesNotMatch(read, /cacheTag|CACHE_TAG/)
  assert.match(read, /let slot=cacheSlotOf\(cover\.level,cell\);\n if\(slot!=0u\)\{/)
  assert.doesNotMatch(CACHE_WORDS_WGSL.text, /cacheTag|CACHE_TAG/)
})

test('a read stays inside the probe’s square of the final atlas: the border the atlas keeps is read at the map’s edge, at every level of detail, never a neighbour’s texels', () => {
  const direction = (i: number) => {
    // A spiral over the sphere, to reach the map's edge and corners.
    const z = 1 - (2 * (i + 0.5)) / 200
    const r = Math.sqrt(1 - z * z)
    return [r * Math.cos(i * 2.399963), r * Math.sin(i * 2.399963), z]
  }
  for (const mips of [1, 2, 3])
    for (const size of [16, 8, 4]) {
      // One probe alone is published, slot zero (the table names it one, zero naming none): every texel read is in its square.
      const scene = cacheScene([true, ...Array(7).fill(false)], mips, 0.5, 'private')
      for (let i = 0; i < 200; i++) {
        const { slots } = scene.run(SCREEN_PROBE_FLAGS.cacheSky, size, false, 0, direction(i))
        assert.ok(slots.length > 0)
        assert.ok(
          slots.every((slot) => slot === 0),
          `${mips} levels, cone ${size}, direction ${i}: ${[...new Set(slots)]}`,
        )
      }
    }
})
