// The radiance cache: its kernels are modules a device takes, its maps and their bytes, the ray's end word, the tiles of a probe and the filter's weights.

import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import {
  cacheFilterEntries,
  cacheMipsEntries,
  cacheTilesEntries,
  cacheTraceEntries,
} from './cache/cacheBindings.ts'
import { reachedBindings } from './reachedBindings.fixture.ts'
import { CACHE_FILTER_PROGRAM } from './cache/cacheFilterWgsl.ts'
import { CACHE_MIPS_PROGRAM } from './cache/cacheMipsWgsl.ts'
import { CACHE_WORDS_WGSL } from './cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { cacheBytes, cacheExtent, cacheTileCapacity } from './cache/cacheLayout.ts'
import { CACHE_TILES_PROGRAM } from './cache/cacheTilesWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { oneLevel } from './atlas.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { CACHE_TRACE_PROGRAM } from './cache/cacheTraceWgsl.ts'
import {
  reservedNames,
  topLevelNames,
  unbalanced,
  unresolvedNames,
} from '../../gpu/core/wgslNames.fixture.ts'

test('every kernel of the radiance cache is a module a device takes: its names declared, none reserved or twice, its bindings the layout holds', () => {
  const kernels = {
    tiles: [CACHE_TILES_PROGRAM, cacheTilesEntries(), ['clearPdf', 'generateTiles']],
    trace: [CACHE_TRACE_PROGRAM, cacheTraceEntries(), ['traceTiles']],
    filter: [CACHE_FILTER_PROGRAM, cacheFilterEntries(), ['filterMaps']],
    mips: [CACHE_MIPS_PROGRAM, cacheMipsEntries(), ['buildMip']],
  } as const
  for (const [name, [code, entries, points]] of Object.entries(kernels)) {
    assert.deepEqual(unresolvedNames(code), [], name)
    assert.deepEqual(reservedNames(code), [], name)
    assert.equal(unbalanced(code), '', name)
    const names = topLevelNames(code)
    assert.equal(new Set(names).size, names.length, name)
    const declared = [...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map((m) => +m[1])
    const held = entries.map((entry) => entry.binding)
    assert.ok(
      held.every((binding) => declared.includes(binding)),
      `${name}: its layout's bindings are declared`,
    )
    for (const [binding, variable] of reachedBindings(code, points))
      assert.ok(
        held.includes(binding),
        `${name} reaches ${variable} (${binding}), its layout holds none`,
      )
    for (const point of points) assert.ok(code.includes(`fn ${point}(`), `${name} ${point}`)
  }
})

test('the radiance cache holds the pool’s own number of maps in two atlases and the levels of detail and the sky’s share only where they are asked', () => {
  const pool = BOUNCE_SETTINGS.probePool
  assert.deepEqual(
    [cacheExtent(16, pool), cacheExtent(32, pool)],
    [
      [2048, 2048],
      [4096, 4096],
    ],
  )
  const shape = (resolution: number, mipmaps = 1, skyVisibility = false) => ({
    resolution,
    mipmaps,
    skyVisibility,
  })
  const texels = 4096 * 4096
  // The raw map eight bytes a texel, the final four.
  const base = cacheBytes(shape(32), pool)
  assert.equal(base - cacheBytes(shape(16), pool) > 8 * texels, true)
  assert.equal(cacheBytes(shape(32, 3), pool) - base, 4 * texels * (1 / 4 + 1 / 16))
  assert.equal(cacheBytes(shape(32, 1, true), pool) - base, 4 * texels)
  // A map is traced in at most as many tiles as it has texels at twice its side, of eight by eight, for every probe a frame queues.
  assert.deepEqual([cacheTileCapacity(16), cacheTileCapacity(32)], [768 * 16, 768 * 64])
})

test('a ray’s end keeps its distance in a half float, whether it met a surface and the share of it that left the scene, and the level that covers a point is the first whose cube holds it half a cell inside', () => {
  const levels = [1, 2, 4, 8].map((spacing) => ({ base: [-24, -24, -24], spacing }))
  const kit = shaderRun<{
    cacheDepthWord: (distance: number, hit: boolean, sky: number) => number
    cacheDepthOf: (word: number) => number
    cacheHitIs: (word: number) => boolean
    cacheSkyOf: (word: number) => number
    cacheTileOf: (slot: number, resolution: number) => number[]
    cacheCoverage: (P: number[]) => { level: number; valid: boolean; minTrace: number }
  }>(
    wgslModule(bounceBindingsWgsl(0, 0, 1), CACHE_WORDS_WGSL),
    ['cacheDepthWord', 'cacheDepthOf', 'cacheHitIs', 'cacheSkyOf', 'cacheTileOf', 'cacheCoverage'],
    { bounce: { counts: [48, 4, 110592, 16384], levels }, cellTable: {} },
  )
  const word = kit.cacheDepthWord(12.5, true, 0.5)
  assert.deepEqual([kit.cacheDepthOf(word), kit.cacheHitIs(word)], [12.5, true])
  assert.ok(Math.abs(kit.cacheSkyOf(word) - 0.5) < 1 / 255)
  const missed = kit.cacheDepthWord(200, false, 1)
  assert.deepEqual([kit.cacheHitIs(missed), kit.cacheSkyOf(missed)], [false, 1])
  assert.ok(kit.cacheDepthOf(missed) > 600, 'no hit: the half float’s largest')
  assert.equal(
    kit.cacheDepthOf(kit.cacheDepthWord(1e6, true, 0)) <= 655.04,
    true,
    'held to the half float',
  )
  // The slot's map in the pool's rows: a row of 128.
  assert.deepEqual(kit.cacheTileOf(130, 16), [32, 16])
  const inside = kit.cacheCoverage([0.2, 0.3, 0.1])
  assert.deepEqual([inside.level, inside.valid], [0, true])
  assert.ok(
    Math.abs(inside.minTrace - 2 * Math.sqrt(3)) < 1e-6,
    'the nearest a ray starts and the diagonal again',
  )
  assert.equal(
    kit.cacheCoverage([23.6, 0, 0]).level,
    1,
    'half a cell inside the edge of the finest level, the next answers',
  )
  assert.deepEqual(
    [kit.cacheCoverage([100, 0, 0]).level, kit.cacheCoverage([1000, 0, 0]).valid],
    [3, false],
  )
})

test('the tiles of a probe: a level a whole map, the pixels’ lobes refining the half-side tiles where they look, and nowhere where they gave none', () => {
  const scene = (words: number[] = []) => {
    const entries: number[][] = []
    const tiles = { x: 0, y: 0, one: 1, count: 0, entries }
    const pdf = Array<number>(40).fill(0)
    words.forEach((word, k) => (pdf[k] = word))
    const kit = shaderRun<{
      cacheUniformTiles: (entry: number, level: number, lane: number) => void
      cacheAdaptiveTiles: (entry: number, slot: number, levels: number, lane: number) => void
      cachePdfAt: (slot: number, d: number[]) => number
    }>(CACHE_TILES_PROGRAM, ['cacheUniformTiles', 'cacheAdaptiveTiles', 'cachePdfAt'], {
      cache: { size: [32, 0, 0, 1], distances: [1600, 0, 0.1, 0.2], eye: [0, 0, 0, 0] },
      cachePdf: pdf,
      cacheTiles: tiles,
      arrayLength: () => 1e6,
      bounce: {},
      cellTable: {},
    })
    const lanes = (run: (lane: number) => void) => {
      for (let lane = 0; lane < 64; lane++) run(lane)
      // One entry a tile: the level and the coordinates, each once.
      return entries.map((entry) => `${entry[0] >> 16}:${entry[1] & 0xffff},${entry[1] >> 16}`)
    }
    return { kit, lanes, tiles }
  }
  const unique = (list: string[]) => new Set(list).size === list.length
  for (const [level, count] of [
    [0, 4],
    [1, 16],
    [2, 64],
  ] as const) {
    const { kit, lanes } = scene()
    const found = lanes((lane) => kit.cacheUniformTiles(7, level, lane))
    assert.equal(found.length, count, `level ${level}`)
    assert.ok(unique(found))
  }
  // Without lobes, a probe's tiles stay at half the side whatever the levels it may go to.
  const none = scene()
  assert.equal(none.lanes((lane) => none.kit.cacheAdaptiveTiles(7, 1, 3, lane)).length, 4)
  // Lobes that look everywhere (the constant term alone) refine every tile of level zero into four, and, past the threshold, those into four.
  const scale = SCREEN_PROBE_CONSTANTS.radiancePdfScale
  const all = scene([Math.round(scale), 0, 0, 0, 0, 0, 0, 0, 0, 1])
  const two = all.lanes((lane) => all.kit.cacheAdaptiveTiles(7, 0, 2, lane))
  assert.deepEqual([two.length, two.every((tile) => tile.startsWith('1:'))], [16, true])
  const wide = scene([Math.round(scale), 0, 0, 0, 0, 0, 0, 0, 0, 1])
  assert.equal(wide.lanes((lane) => wide.kit.cacheAdaptiveTiles(7, 0, 3, lane)).length, 64)
  // The mean of the cosine lobes of a surface facing +z (nine coefficients, a count of one): positive along it, little behind it.
  const lobe = shaderRun<{ spCosine: (n: number[]) => number[] }>(
    wgslModule(spCommon([4, 2])),
    ['spCosine'],
    {},
  ).spCosine([0, 0, 1])
  const faced = scene([...lobe.map((c) => Math.round(c * scale)), 1])
  assert.ok(faced.kit.cachePdfAt(0, [0, 0, 1]) > 0.1)
  assert.ok(
    faced.kit.cachePdfAt(0, [0, 0, -1]) < faced.kit.cachePdfAt(0, [0, 0, 1]) / 4,
    'far less behind it',
  )
  assert.equal(none.kit.cachePdfAt(0, [0, 0, 1]), 0, 'no screen probe gave any')
})

test('a neighbour’s light weighs in the filter by the angle its ray makes seen from the probe — a contact keeps its shadow — and nothing where a surface stands between the two probes', () => {
  const res = 16
  const kit = (own: number, neighbour: number) =>
    shaderRun<{
      cacheNeighbourWeight: (
        n: number,
        own: number[],
        centre: number[],
        texel: number[],
        res: number,
        ownBase: number[],
        begin: number,
      ) => number
    }>(CACHE_FILTER_PROGRAM, ['cacheNeighbourWeight'], {
      cache: { size: [res, 0, 0, 1], distances: [0, 0, 0, 0.2], eye: [0, 0, 0, 0] },
      bounce: oneLevel(),
      cellTable: {},
      // The neighbour on +x holds slot 2 (plus one), at the next cell's centre.
      neighbourSlot: [0, 2, 0, 0, 0, 0],
      neighbourCentre: [
        [0, 0, 0],
        [1.5, 0.5, 0.5],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      // Every texel of probe 0's map went `own` metres and met a surface, probe 1's `neighbour`.
      cacheRaw: { load: (at: number[]) => [0, half(at[0] < res ? own : neighbour), 0, 0] },
      textureLoad: (t: { load(at: number[]): number[] }, at: number[]) => t.load(at),
      acos: Math.acos,
    }).cacheNeighbourWeight
  const half = (distance: number) => (builtins.pack2x16float([distance, 0]) as number) & 0xffff
  const weight = (ownDistance: number, neighbourDistance: number, texel = [3, 5]) =>
    kit(ownDistance, neighbourDistance)(
      1,
      [0, half(ownDistance), 0, 0],
      [0.5, 0.5, 0.5],
      texel,
      res,
      [0, 0],
      Math.sqrt(3),
    )
  // Both rays far: the angle is a hundredth of a radian at most, the weight nearly whole.
  const open = weight(100, 100)
  assert.ok(open > 0.9 && open <= 1, `${open}`)
  // The neighbour's ray ends much farther than the probe’s: held to the probe's own, so a contact (a short ray) is not blurred over.
  const contact = weight(1, 100)
  assert.ok(contact < open, `${contact}`)
  // A surface between the two probes: the probe's ray toward the neighbour ends before it reaches it.
  assert.equal(weight(0.3, 100), 0)
})
