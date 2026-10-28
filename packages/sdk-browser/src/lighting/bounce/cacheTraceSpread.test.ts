// The radiance cache's trace, spread: the rays of the trace atlas spread to the texels they stand for, the order of the trace tiles and the sky light that leaks onto a hit.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { CACHE_TILES_PROGRAM } from './cache/cacheTilesWgsl.ts'
import {
  cacheSplatProgramOf,
  cacheTracedProgramOf,
  cacheTraceProgramOf,
} from './cache/cacheTraceWgsl.ts'
import { CACHE_WORDS_WGSL } from './cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { ditherLight, packLight } from '../../gpu/core/smallFloatWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

const CACHE_TRACE_PROGRAM = cacheTraceProgramOf(WORD_LIGHT_FORMAT)
const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)
const CACHE_SPLAT_PROGRAM = cacheSplatProgramOf(WORD_LIGHT_FORMAT)

const words = shaderRun<{
  cacheDepthWord: (
    distance: number,
    hit: boolean,
    sky: number,
    front: boolean,
    twoSided: boolean,
  ) => number
  packLight: (c: number[]) => number
  ditherLight: (c: number[], e: number) => number[]
}>(
  wgslModule(bounceBindingsWgsl(0, 0, 1), CACHE_WORDS_WGSL, packLight, ditherLight),
  ['cacheDepthWord', 'packLight', 'ditherLight'],
  { bounce: {}, cellTable: {} },
)

/** The spread of a trace atlas into the raw atlas, run as a workgroup runs it: a tile of the list at `level`, its probe in slot 3, the rays of
 *  the trace atlas `atlas(x, y)` (a light and a distance), every thread twice — the first pass fills the workgroup's memory the mean reads, the
 *  second is the one counted. Returns what was stored. */
function spread(
  level: number,
  atlas: (x: number, y: number) => { light: number; distance: number },
  noise = 0,
) {
  const stores: { at: number[]; v: number[] }[] = []
  const kit = shaderRun<{
    spreadTiles: (group: number[], groups: number[], lane: number) => void
  }>(CACHE_SPLAT_PROGRAM, ['spreadTiles'], {
    cache: { resolution: 16 },
    // The tile, and the cell the first tile of the slice is kept in.
    cacheTiles: {
      count: 1,
      entries: [
        [level << 16, 0],
        [0, 0],
      ],
    },
    arrayLength: () => 2,
    bounce: { counts: [48, 1, 110592, 16384], frame: [0, 1, 0, 0] },
    cellTable: {},
    queuedProbe: () => ({ valid: true, slot: 3 }),
    traceAtlas: {
      load: (at: number[]) => {
        const { light, distance } = atlas(at[0], at[1])
        return [
          words.packLight([light, 0, 0]),
          words.cacheDepthWord(distance, true, 0, true, false),
          0,
          0,
        ]
      },
    },
    rawOut: {},
    tileLight: [],
    tileWord: [],
    workgroupBarrier: () => undefined,
    textureLoad: (t: { load(at: number[]): number[] }, at: number[]) => t.load(at),
    textureStore: (_: unknown, at: number[], v: number[]) => stores.push({ at, v }),
    rand3dPcg16: () => [noise, 0, 0],
  })
  for (let pass = 0; pass < 2; pass++) {
    stores.length = 0
    for (let lane = 0; lane < 64; lane++) kit.spreadTiles([0, 0, 0], [1, 1, 1], lane)
  }
  return stores
}

test('a tile of level zero spreads each ray of the trace atlas to the four texels it stands for, in the probe’s map by its slot', () => {
  const stores = spread(0, (x, y) => ({ light: 1 + x / 8, distance: 10 + y }))
  assert.equal(stores.length, 64 * 4)
  // The map of slot 3 is the square at 3 × 16 along the first row; the ray of the thread (1, 2) stands for the texels (2..3, 4..5) of it.
  const at = (x: number, y: number) => stores.find((s) => s.at[0] === 48 + x && s.at[1] === y)!
  const expected = [
    words.packLight([1 + 1 / 8, 0, 0]),
    words.cacheDepthWord(12, true, 0, true, false),
  ]
  for (const [x, y] of [
    [2, 4],
    [3, 4],
    [2, 5],
    [3, 5],
  ])
    assert.deepEqual(at(x, y).v.slice(0, 2), expected)
})

test('a tile of level one spreads each ray to the one texel it stands for, dithered by a hash of the texel; a tile of level two the mean of the four rays it covers, the nearest of their distances', () => {
  const one = spread(1, (_, y) => ({ light: 2, distance: 10 + y }))
  assert.equal(one.length, 64)
  // Quantised again at its texel, as a mean of one ray: the hash here draws zero, the dither's lowest.
  assert.deepEqual(one.find((s) => s.at[0] === 48 + 3 && s.at[1] === 5)!.v.slice(0, 2), [
    words.packLight(words.ditherLight([2, 0, 0], 0)),
    words.cacheDepthWord(15, true, 0, true, false),
  ])
  // Four rays a texel: the mean of 2 × 2 of them, held in the first 4 × 4 threads, the nearest distance of the four.
  const two = spread(2, (x, y) => ({ light: 2 + (x % 2) * 0.5, distance: 10 + ((x + y) % 4) }))
  assert.equal(two.length, 16)
  // The texel (1, 2) is the mean of the threads (2, 4), (3, 4), (2, 5) and (3, 5): lights 2, 2.5, 2 and 2.5, a mean of 2.25; distances
  // (2 + 4) % 4 = 2, 3, 3 and 0 over ten: the nearest 10.
  assert.deepEqual(two.find((s) => s.at[0] === 48 + 1 && s.at[1] === 2)!.v.slice(0, 2), [
    words.packLight(words.ditherLight([2.25, 0, 0], 0)),
    words.cacheDepthWord(10, true, 0, true, false),
  ])
})

test('the trace writes the light of a ray multiplied by the pre-exposure the cache keeps it under, whichever way the ray is cast', () => {
  for (const program of [CACHE_TRACE_PROGRAM, CACHE_TRACED_PROGRAM])
    assert.match(program, /traceRayLight\(light\*bounce\.reach\.z,rank,local\)/)
})

test('the trace tiles are ordered by the direction they trace, in groups of 64, by a counting sort over eight bins along each side of the probe’s map', () => {
  const code = CACHE_TILES_PROGRAM
  assert.match(code, /fn sortTiles\(/)
  assert.match(code, /@workgroup_size\(64\)\nfn sortTiles/)
  // The bin: the tile’s first texel over the trace resolution, scaled to eight; the place: after the tiles of the bins before, then the order of arrival in the bin.
  assert.match(code, /let bin=coord\*CACHE_TILE_SIDE\*8u\/\(\(cache\.resolution\/2u\)<<level\);/)
  assert.match(code, /place\+=atomicLoad\(&sortCounts\[before\]\);/)
  // Only the first workgroup of a group of 64 tiles sorts the group.
  assert.match(code, /if\(first%64u!=0u\)\{return;\}/)
})

test('the sky light that leaks onto what a ray met is added only where the rays go through the triangles (the traced flag) and the cache makes irradiance maps (the leak flag)', () => {
  for (const code of [CACHE_TRACED_PROGRAM, CACHE_TRACE_PROGRAM]) {
    assert.match(code, /fn cacheSkyLeak\(d:vec3f,distance:f32\)->vec3f/)
    assert.match(
      code,
      /skyLightReflection\(d,cache\.leak\.w\)\*cache\.leak\.xyz\*saturate\(distance\*cache\.leakDistance\)/,
    )
    assert.match(
      code,
      /let leaks=\(cache\.flags&\(CACHE_FLAG_TRACED\|CACHE_FLAG_LEAK\)\)==\(CACHE_FLAG_TRACED\|CACHE_FLAG_LEAK\);/,
    )
  }
})
