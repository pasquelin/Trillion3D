// The screen probes' read of the radiance cache and their scatter into its importance functions.

import test from 'node:test'
import assert from 'node:assert/strict'
import { f32Bits } from '../../../../math/src/float/bits.ts'
import { ATLAS_CALLS, CORNER_CELLS, cellProbes, oneLevel } from './atlas.fixture.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { CACHE_WORDS_WGSL } from './cache/cacheWordsWgsl.ts'
import { spCacheRead } from './screen/cacheReadWgsl.ts'
import { scatterShader } from './screen/cacheScatterWgsl.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { SCREEN_PROBE_FLAGS } from './screen/screenProbeLayout.ts'
import { packLight } from '../../gpu/core/smallFloatWgsl.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

/** The cache's depth word and the light word, run on the shipped text. */
function wordKits() {
  return {
    words: shaderRun<{ cacheDepthWord: (distance: number, hit: boolean, sky: number) => number }>(
      wgslModule(bounceBindingsWgsl(0, 0, 1), CACHE_WORDS_WGSL),
      ['cacheDepthWord'],
      { bounce: {}, probes: {} },
    ),
    light: shaderRun<{ packLight: (c: number[]) => number }>(
      wgslModule(packLight),
      ['packLight'],
      {},
    ),
  }
}

/** The world's probes round the point `(0.3, 0.4, 0.2)` of the finest level — the cells of the cube beside it, a slot each —,
 *  their tables and tags made, and the cache's maps simulated: every texel of the final map of probe `k` the light `(k + 1, 0, 0)`,
 *  the raw ones a ray that went `20` metres, `sky` of it left the scene. `valid` names the probes whose tag is made. */
function cacheScene(valid: boolean[], mips: number, sky = 0) {
  const cache = { res: 16, side: 48, pool: BOUNCE_SETTINGS.probePool }
  const atlas = cellProbes(CORNER_CELLS)
  const { words, light } = wordKits()
  const tags = new Uint32Array(cache.pool * 4)
  // The tag is the cell's integers as unsigned words; the JavaScript run takes a `bitcast` for a float's, so the double holds those.
  CORNER_CELLS.forEach((cell, k) => {
    if (valid[k]) tags.set([...cell.map((c) => f32Bits(c)), 1], k * 4)
  })
  const loads: number[] = []
  const slotOf = (at: number[], side: number) =>
    Math.floor(at[0] / side) + 128 * Math.floor(at[1] / side)
  const finalMap = {
    load: (at: number[], level: number) => (
      loads.push(level),
      [light.packLight([slotOf(at, cache.res >> level) + 1, 0, 0]), 0, 0, 0]
    ),
  }
  const rawMap = { load: () => [0, words.cacheDepthWord(20, true, sky), 0, 0] }
  const skyMap = { load: () => [sky, 0, 0, 0] }
  const run = (flags: number, size: number) => {
    const scope = {
      bounce: oneLevel(cache.side),
      sp: { cache: [1.5, cache.res, mips, 0], mode: [0, 0, flags, 0], spatial: [0, 0, 0, 200] },
      probes: atlas,
      cacheFinal: finalMap,
      cacheRaw: rawMap,
      cacheSky: skyMap,
      cacheTags: tags,
      // A sky light shines: a ray that leaves the scene reaches its cube, `(2, 3, 4)` every way.
      skyLightApplied: () => true,
      skyLightRay: () => [2, 3, 4],
      directLights: { atmosphere: Array.from({ length: 4 }, () => [0, 0, 0, 0]) },
      cacheCorner: Array<number>(8).fill(0),
      cachePlace: Array.from({ length: 8 }, () => [0, 0, 0]),
      cacheAlpha: [0, 0, 0],
      cacheLevelHeld: 0,
      textureLoad: (t: unknown, at: number[], a: number, b?: number) =>
        t === atlas
          ? ATLAS_CALLS.textureLoad(atlas, at, a)
          : (t as typeof finalMap).load(at, a ?? b ?? 0),
    }
    const kit = shaderRun<{
      spCacheGather: (P: number[], lane: number) => void
      spCacheSample: (
        P: number[],
        d: number[],
        size: number,
      ) => { radiance: number[]; distance: number; sky: number }
    }>(
      wgslModule(bounceBindingsWgsl(0, 0, 1), spCommon([4, 2]), spCacheRead(2, 3, 4, 5)),
      ['spCacheGather', 'spCacheSample'],
      scope,
    )
    const P = [0.3, 0.4, 0.2]
    for (let lane = 0; lane < 8; lane++) kit.spCacheGather(P, lane)
    loads.length = 0
    return { sample: kit.spCacheSample(P, [0, 0, 1], size), loads: [...loads] }
  }
  return { run }
}

test('a ray reads the cache by the eight probes round its point, each at its trilinear share, none where its map was not made, the level of detail its cone asks, and the sky where it is kept apart', () => {
  const alpha = [0.8, 0.9, 0.7],
    share = (k: number) =>
      alpha.reduce((product, a, axis) => product * ((k >> axis) & 1 ? a : 1 - a), 1)
  const whole = cacheScene(Array(8).fill(true), 1).run(0, 16).sample
  assert.ok(Math.abs(whole.distance - 20) < 1e-3, `every probe went 20 m: ${whole.distance}`)
  // The probe at corner 5 holds no map made for its cell: it gives nothing, its share of the point is lost.
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

test('a screen probe adds the mean of the cosine lobes it stands for to the eight probes of the cache round its point, in fixed point, with a count of one; none where no probe holds the cell, and none for a probe on no surface', () => {
  const scale = SCREEN_PROBE_CONSTANTS.radiancePdfScale
  const brdf = Array.from({ length: 9 }, (_, k) => 0.1 * (k + 1) * (k % 2 ? -1 : 1))
  // Slots 0 to 7 hold the cube's cells but the one at corner 3, which no probe holds.
  const atlas = cellProbes(CORNER_CELLS.filter((_, k) => k !== 3))
  const dispatch = (depth: number) => {
    const pdf = Array<number>(8 * 10).fill(0)
    const scatter = shaderRun<{
      scatterPdf: (group: number[], local: number[]) => void
    }>(scatterShader([4, 2]), ['scatterPdf'], {
      sp: { grid: [1, 1, 1, 0], counts: [0, 1, 0, 0], mode: [0, 0, 0, 0] },
      bounce: oneLevel(),
      probes: atlas,
      probeInfo: { load: () => [0.3, 0.4, 0.2, depth] },
      probeNormal: { load: () => [0, 0, 1, 0] },
      probeCounts: [0],
      brdfSh: brdf,
      cachePdf: pdf,
      textureLoad: (t: unknown, at: number[], a: number) =>
        t === atlas ? ATLAS_CALLS.textureLoad(atlas, at, a) : (t as { load(): number[] }).load(),
    })
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) scatter.scatterPdf([0, 0, 0], [x, y, 0])
    return pdf
  }
  const found = dispatch(5)
  const word = (slot: number) => found.slice(slot * 10, slot * 10 + 10)
  // The slot's number is the probe's: corners 0 to 2 are slots 0 to 2, the missing corner 3 is none, corners 4 to 7 are slots 3 to 6.
  for (const slot of [0, 1, 2, 3, 4, 5, 6])
    assert.deepEqual(word(slot), [...brdf.map((c) => Math.trunc(c * scale)), 1], `slot ${slot}`)
  assert.deepEqual(word(7), Array(10).fill(0), 'no cell holds slot 7')
  assert.deepEqual(dispatch(-1), Array(80).fill(0), 'a probe on no surface adds none')
})
