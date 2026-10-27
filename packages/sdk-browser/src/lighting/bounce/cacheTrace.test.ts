// The radiance cache's trace: the tiles of a probe and the dither of the light of a ray.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { CACHE_TILES_PROGRAM } from './cache/cacheTilesWgsl.ts'
import { oneLevel } from './atlas.fixture.ts'
import {
  CACHE_SPLAT_PROGRAM,
  CACHE_TRACED_PROGRAM,
  CACHE_TRACE_PROGRAM,
} from './cache/cacheTraceWgsl.ts'
import { CACHE_WORDS_WGSL } from './cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from './gridWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { ditherLight, packLight } from '../../gpu/core/smallFloatWgsl.ts'

test('the tiles of a probe: a level a whole map; the setting’s level, half past the downsample distance or for a probe first traced without room, twice within the supersample distance', () => {
  const scene = (
    eye: number[],
    settings: {
      level: number
      supersampleSq?: number
      forward?: number[]
      resolution?: number
      flags?: number
    },
    downsampled = false,
  ) => {
    const entries: number[][] = []
    const tiles = { x: 0, y: 0, one: 1, count: 0, entries }
    const kit = shaderRun<{
      cacheUniformTiles: (entry: number, level: number, lane: number) => void
      generateTiles: (group: number[], lane: number) => void
    }>(CACHE_TILES_PROGRAM, ['cacheUniformTiles', 'generateTiles'], {
      cache: {
        resolution: settings.resolution ?? 32,
        flags: settings.flags ?? 0,
        level: settings.level,
        downsampleSq: 1600,
        supersampleSq: settings.supersampleSq ?? 0,
        filterAngle: 0.2,
        eye,
      },
      cacheTiles: tiles,
      arrayLength: () => 1e6,
      bounce: {
        ...oneLevel(),
        frame: [0, 1, 0, 0],
        forward: settings.forward ? [...settings.forward, 1] : [0, 0, 0, 0],
      },
      cellTable: {},
      queuedProbe: () => ({ valid: true, cell: [0, 0, 0], level: 0, slot: 3, downsampled }),
    })
    const lanes = (run: (lane: number) => void) => {
      for (let lane = 0; lane < 64; lane++) run(lane)
      // One entry a tile: the level and the coordinates, each once.
      return entries.map((entry) => `${entry[0] >> 16}:${entry[1] & 0xffff},${entry[1] >> 16}`)
    }
    return { kit, lanes }
  }
  const unique = (list: string[]) => new Set(list).size === list.length
  for (const [level, count] of [
    [0, 4],
    [1, 16],
    [2, 64],
  ] as const) {
    const { kit, lanes } = scene([0, 0, 0, 0], { level: 1 })
    const found = lanes((lane) => kit.cacheUniformTiles(7, level, lane))
    assert.equal(found.length, count, `level ${level}`)
    assert.ok(unique(found))
  }
  // A map under sixteen texels a side has no tile at level zero (and, at eight, none at level two): it is one tile of the whole side, traced at
  // level one; a map of sixteen is one tile at level zero, four at level one, sixteen at level two.
  for (const [resolution, counts, levels] of [
    [8, [1, 1, 1], [1, 1, 1]],
    [16, [1, 4, 16], [0, 1, 2]],
  ] as const) {
    counts.forEach((count, level) => {
      const { kit, lanes } = scene([0, 0, 0, 0], { level: 1, resolution })
      const found = lanes((lane) => kit.cacheUniformTiles(7, level, lane))
      assert.equal(found.length, count, `${resolution} texels, level ${level}`)
      assert.ok(unique(found))
      assert.ok(
        found.every((tile) => tile.startsWith(`${levels[level]}:`)),
        `${resolution} texels, level ${level} traced at ${levels[level]}`,
      )
    })
  }
  const levelOf = (found: string[]) => [...new Set(found.map((tile) => +tile.split(':')[0]))]
  const traced = (
    eye: number[],
    settings: { level: number; supersampleSq?: number; forward?: number[]; flags?: number },
    downsampled = false,
  ) => {
    const { kit, lanes } = scene(eye, settings, downsampled)
    return levelOf(lanes((lane) => kit.generateTiles([0, 0, 0], lane)))
  }
  // The setting's level near the eye: the whole side by default, half of it or twice it where the setting forces it.
  assert.deepEqual(
    [0, 1, 2].map((level) => traced([0, 0, 0, 0], { level })),
    [[0], [1], [2]],
  )
  // Past the downsample distance (40 metres), or first traced where the budget had no room: half the side, whatever the setting.
  assert.deepEqual(traced([100, 0, 0, 0], { level: 2 }), [0])
  assert.deepEqual(traced([0, 0, 0, 0], { level: 2 }, true), [0])
  // Within the supersample distance: twice the side.
  assert.deepEqual(traced([0, 0, 0, 0], { level: 1, supersampleSq: 25 }), [2])
  assert.deepEqual(traced([10, 0, 0, 0], { level: 1, supersampleSq: 25 }), [1])
  // Under an orthographic view the distance is the vector's length squared over its extent along the view: from the probe of the cell
  // (0, 0, 0) the eye at 27 metres along x and z is 38.2 away, within the 40 metres, but 54 along the view's direction, past them.
  assert.deepEqual(traced([27, 0, 27, 0], { level: 1 }), [1])
  assert.deepEqual(traced([27, 0, 27, 0], { level: 1, forward: [0, 0, -1] }), [0])
  // A full update whose rays go through the trace atlas traces every probe at half the side, the size the atlas is laid out for; either alone
  // changes nothing.
  const TRACED = 1 << 2,
    FULL = 1 << 3
  assert.deepEqual(traced([0, 0, 0, 0], { level: 1, supersampleSq: 25, flags: TRACED | FULL }), [0])
  assert.deepEqual(traced([0, 0, 0, 0], { level: 2, flags: TRACED | FULL }), [0])
  assert.deepEqual(traced([0, 0, 0, 0], { level: 1, supersampleSq: 25, flags: TRACED }), [2])
  assert.deepEqual(traced([0, 0, 0, 0], { level: 1, supersampleSq: 25, flags: FULL }), [2])
})

test('the light of a ray cast through the scene’s triangles is dithered by a hash of its place in the trace’s own atlas, tiles in rows of 512, and of the image’s turn', () => {
  const hashed: number[][] = []
  const kit = shaderRun<{
    traceAtlasAt: (rank: number, local: number[]) => number[]
    cacheDither: (at: number[]) => number
  }>(CACHE_TRACED_PROGRAM, ['traceAtlasAt', 'cacheDither'], {
    bounce: { frame: [0, 0, 11, 0] },
    rand3dPcg16: (p: number[]) => (hashed.push(p), [16384, 0, 0]),
  })
  assert.deepEqual(kit.traceAtlasAt(0, [3, 2]), [3, 2])
  assert.deepEqual(
    kit.traceAtlasAt(513, [3, 2]),
    [11, 10],
    'the second row of tiles, the second tile',
  )
  assert.equal(kit.cacheDither([5, 6]), 0.25)
  assert.deepEqual(hashed, [[5, 6, 3]], 'the place and the turn modulo eight')
})

test('the march through the global distance field writes the light of a ray as found, and only the trace through the triangles quantises it where it is traced and dithers the mean of a coarser tile where it is spread', () => {
  const lightOf = (program: string, name: 'traceRayLight' | 'traceMeanLight') =>
    shaderRun<{
      traceRayLight: (light: number[], rank: number, local: number[]) => number[]
      traceMeanLight: (light: number[], at: number[]) => number[]
    }>(program, [name], {
      bounce: { frame: [0, 0, 11, 0] },
      rand3dPcg16: () => [16384, 0, 0],
    })
  // A light between two steps of the 11-11-10 word's mantissas, in each channel.
  const light = [1.0001, 2.0003, 0.5003]
  assert.deepEqual(
    lightOf(CACHE_TRACE_PROGRAM, 'traceRayLight').traceRayLight(light, 3, [1, 2]),
    light,
  )
  assert.deepEqual(
    lightOf(CACHE_TRACE_PROGRAM, 'traceMeanLight').traceMeanLight(light, [5, 6]),
    light,
  )
  assert.doesNotMatch(CACHE_TRACE_PROGRAM, /ditherLight|traceAtlasAt/)
  assert.notDeepEqual(
    lightOf(CACHE_TRACED_PROGRAM, 'traceRayLight').traceRayLight(light, 3, [1, 2]),
    light,
    'quantised as the trace atlas keeps it',
  )
  assert.notDeepEqual(
    lightOf(CACHE_SPLAT_PROGRAM, 'traceMeanLight').traceMeanLight(light, [5, 6]),
    light,
    'a mean is dithered again',
  )
  assert.doesNotMatch(CACHE_TRACED_PROGRAM, /traceMeanLight/)
  assert.doesNotMatch(CACHE_SPLAT_PROGRAM, /traceRayLight/)
})

test('the trace through the triangles writes each ray to the trace atlas at its tile’s place in the list and the march writes it to the raw atlas by the probe’s slot; neither does the other’s', () => {
  assert.match(
    CACHE_TRACED_PROGRAM,
    /textureStore\(traceOut,traceAtlasAt\(rank,local\),cacheRawWord\(ray\.seen,ray\.word\)\);/,
  )
  assert.doesNotMatch(CACHE_TRACED_PROGRAM, /spreadTile|rawOut|cacheTileOf\(queued\.slot/)
  assert.match(
    CACHE_TRACE_PROGRAM,
    /spreadTile\(cacheTileOf\(queued\.slot,res\),at,local,trace,lane,ray\.seen,ray\.word\);/,
  )
  assert.doesNotMatch(CACHE_TRACE_PROGRAM, /traceOut|traceAtlasAt/)
})

/** The cache's depth word and the light word, run on the shipped text. */
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
    cacheTiles: { count: 1, entries: [[level << 16, 0]] },
    arrayLength: () => 1e6,
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
