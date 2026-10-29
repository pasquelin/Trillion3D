// The radiance cache's trace: the tiles of a probe and the dither of the light of a ray.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { CACHE_TILES_PROGRAM } from './cache/cacheTilesWgsl.ts'
import { oneLevel } from './atlas.fixture.ts'
import {
  cacheSplatProgramOf,
  cacheTracedProgramOf,
  cacheTraceProgramOf,
} from './cache/cacheTraceWgsl.ts'
import { ditherLight } from '../../gpu/core/smallFloatWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

const CACHE_TRACE_PROGRAM = cacheTraceProgramOf(WORD_LIGHT_FORMAT)
const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)
const CACHE_SPLAT_PROGRAM = cacheSplatProgramOf(WORD_LIGHT_FORMAT)

test('the tiles of a probe: a level a whole map; the setting’s level, half past the downsample distance or for a probe first traced without room, twice within the supersample distance', () => {
  const scene = (
    eye: number[],
    settings: {
      level: number
      supersampleSq?: number
      forward?: number[]
      resolution?: number
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
        flags: 0,
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
      queuedProbe: () => ({
        valid: true,
        cell: [0, 0, 0],
        level: 0,
        slot: 3,
        downsampled,
        offset: [0, 0, 0],
        rank: 0,
      }),
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
  // The reference traces a texel only where it lies within the trace resolution (RCH.usf:225); the tiles here never reach past it, so no test is needed: for every
  // map side and level, the tiles of a probe cover at most `trace` texels along a side (a side not a multiple of sixteen leaves some untraced, in both).
  for (const resolution of [8, 16, 24, 32, 40, 48, 64])
    for (const level of [0, 1, 2]) {
      const { kit, lanes } = scene([0, 0, 0, 0], { level: 1, resolution })
      const found = lanes((lane) => kit.cacheUniformTiles(7, level, lane))
      const traced = Math.max(...found.map((tile) => +tile.split(':')[0]))
      const side = (resolution / 2) * 2 ** traced
      const reach =
        Math.max(
          ...found.map((tile) => Math.max(...tile.split(':')[1].split(',').map(Number)) + 1),
        ) * 8
      assert.ok(
        reach <= side || found.length === 1,
        `${resolution} texels, level ${level}: tiles within ${side}`,
      )
    }
  const levelOf = (found: string[]) => [...new Set(found.map((tile) => +tile.split(':')[0]))]
  const traced = (
    eye: number[],
    settings: { level: number; supersampleSq?: number; forward?: number[] },
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
    /spreadTile\(cacheTileOf\(queued\.slot,res\),at,local,trace,lane,ray\.seen,ray\.word,inside\);/,
  )
  assert.doesNotMatch(CACHE_TRACE_PROGRAM, /traceOut|traceAtlasAt/)
})

test('a thread whose texel lies past the level’s rays traces none and writes none, in the march and in the trace through the triangles', () => {
  for (const program of [CACHE_TRACE_PROGRAM, CACHE_TRACED_PROGRAM])
    assert.match(program, /let inside=all\(at\*CACHE_TILE_SIDE\+local<vec2u\(trace\)\);/)
  assert.match(CACHE_TRACED_PROGRAM, / if\(inside\)\{\n  let ray=traceTileRay\(/)
  assert.match(CACHE_TRACE_PROGRAM, / if\(inside\)\{ray=traceTileRay\(/)
  assert.match(CACHE_TRACE_PROGRAM, /if\(inside\)\{textureStore\(rawOut,base\+texel\*factor/)
})

/** The cache's depth word and the light word, run on the shipped text. */
