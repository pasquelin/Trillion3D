// The radiance cache: its kernels are modules a device takes, its maps and their bytes, and the atlases of a frame.

import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import {
  cacheFilterEntries,
  cacheFixupEntries,
  cacheSplatEntries,
  cacheTilesEntries,
  cacheTraceEntries,
  cacheTracedLayouts,
} from './cache/cacheBindings.ts'
import { reachedBindings } from './reachedBindings.fixture.ts'
import { cacheFilterProgram } from './cache/cacheFilterWgsl.ts'
import { cacheFixupProgram } from './cache/cacheFixupWgsl.ts'
import {
  RADIANCE_CACHE_FLAGS,
  radianceCacheFormats,
  RADIANCE_CACHE_PARAMS,
  RADIANCE_CACHE_PARAMS_BYTES,
  cacheBytes,
  cacheExtent,
  cacheFinalSide,
  cacheTempExtent,
  cacheTileCapacity,
  cacheTraceExtent,
  cacheTraceSlices,
  cacheTraceTiles,
} from './cache/cacheLayout.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { writeCacheParams } from './cache/cacheGroups.ts'
import { listBytes } from '../../gpu/dispatch/list.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { POOL_ROW_PROBES } from './atlas.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { CACHE_TILES_PROGRAM } from './cache/cacheTilesWgsl.ts'
import {
  cacheSplatProgramOf,
  cacheTracedProgramOf,
  cacheTraceProgramOf,
} from './cache/cacheTraceWgsl.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createRadianceCache } from './cache/radianceCache.ts'
import type { CacheKernels } from './cache/cacheKernels.ts'
import type { CacheWiring } from './cache/cacheGroups.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

const CACHE_FILTER_PROGRAM = cacheFilterProgram(WORD_LIGHT_FORMAT)
const CACHE_FIXUP_PROGRAM = cacheFixupProgram(WORD_LIGHT_FORMAT)
const CACHE_TRACE_PROGRAM = cacheTraceProgramOf(WORD_LIGHT_FORMAT)
const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)
const CACHE_SPLAT_PROGRAM = cacheSplatProgramOf(WORD_LIGHT_FORMAT)

test('every kernel of the radiance cache is a module a device takes: its names declared, none reserved or twice, its bindings the layout holds', () => {
  const kernels = {
    tiles: [CACHE_TILES_PROGRAM, cacheTilesEntries(), ['generateTiles']],
    trace: [CACHE_TRACE_PROGRAM, cacheTraceEntries(), ['traceTiles']],
    traced: [CACHE_TRACED_PROGRAM, cacheTracedLayouts()[0], ['traceTiles']],
    splat: [CACHE_SPLAT_PROGRAM, cacheSplatEntries(), ['spreadTiles']],
    filter: [CACHE_FILTER_PROGRAM, cacheFilterEntries(), ['filterMaps']],
    fixup: [CACHE_FIXUP_PROGRAM, cacheFixupEntries(), ['fixupMaps']],
  } as const
  for (const [name, [code, entries, points]] of Object.entries(kernels)) {
    assertProgramAssembles(code, undefined, name)
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
    light: 'r32uint' as const,
  })
  // The raw map eight bytes a texel; the final one four, over the map and its border, each level of detail a quarter of the one before; the
  // sky's share four, over the first level alone; and the tile list and the parameters.
  const area = ([width, height]: number[]) => width * height
  const finalBytes = (resolution: number, mipmaps: number, sky = false) => {
    const extent = cacheExtent(cacheFinalSide(resolution, mipmaps), pool)
    let bytes = sky ? 4 * area(extent) : 0
    for (let level = 0; level < mipmaps; level++)
      bytes += 4 * (extent[0] >> level) * (extent[1] >> level)
    return bytes
  }
  const expected = (resolution: number, mipmaps: number, sky = false) =>
    8 * area(cacheExtent(resolution, pool)) +
    finalBytes(resolution, mipmaps, sky) +
    listBytes(cacheTileCapacity(resolution, pool), 2) +
    RADIANCE_CACHE_PARAMS_BYTES
  for (const [resolution, mipmaps, sky] of [
    [16, 1, false],
    [32, 1, false],
    [32, 3, false],
    [32, 1, true],
  ] as const)
    assert.equal(
      cacheBytes(shape(resolution, mipmaps, sky), pool),
      expected(resolution, mipmaps, sky),
      `${resolution} texels, ${mipmaps} levels, sky ${sky}`,
    )
  // A map is traced in at most as many tiles as it has texels at twice its side, of eight by eight, for every probe a frame queues, and one cell for
  // the first tile of the slice being traced.
  assert.deepEqual(
    [cacheTileCapacity(16, pool), cacheTileCapacity(32, pool)],
    [pool * 16 + 1, pool * 64 + 1],
  )
})

test('the final atlas holds the pool’s maps with a border of 2^(levels − 1) texels all round, at every level of detail at that level’s own side and border, for eight texels a map with three levels and for sixteen with one', () => {
  const pool = BOUNCE_SETTINGS.probePool
  for (const [resolution, mipmaps] of [
    [8, 3],
    [16, 3],
    [16, 1],
  ] as const) {
    const border = 1 << (mipmaps - 1)
    const side = cacheFinalSide(resolution, mipmaps)
    assert.equal(side, resolution + 2 * border)
    const [width, height] = cacheExtent(side, pool)
    for (let level = 0; level < mipmaps; level++) {
      const levelSide = side >> level
      assert.equal(levelSide << level, side, `${resolution} texels: level ${level} is a whole side`)
      assert.equal(
        levelSide,
        (resolution >> level) + 2 * (border >> level),
        `level ${level} of ${resolution}: the map and its border, each halved`,
      )
      assert.ok(
        border >> level >= 1,
        `level ${level} of ${resolution}: a border of a texel at least`,
      )
      assert.equal(
        width >> level,
        POOL_ROW_PROBES * levelSide,
        `level ${level} of ${resolution}: a row`,
      )
      assert.equal(
        height >> level,
        ceilDiv(pool, POOL_ROW_PROBES) * levelSide,
        `level ${level} of ${resolution}: the rows`,
      )
    }
  }
  // One cell more than the tiles: the first tile of the slice being traced.
  assert.equal(cacheTileCapacity(8, pool), pool * 4 + 1)
  assert.equal(cacheTileCapacity(16, pool), pool * 16 + 1)
})

test('the atlases of a frame follow the queue’s block of probes: a square of the map a probe, rows of the queue’s width; the trace atlas holds the tiles of every probe traced at half the side, four times that where the tiles are forced to twice the side', () => {
  const queue = { row: 64, probes: 64 * 43 }
  assert.deepEqual(cacheTempExtent(16, queue), [64 * 16, 43 * 16])
  assert.deepEqual(cacheTempExtent(16, { row: 128, probes: 100 }), [128 * 16, 16])
  // A map of sixteen texels is one tile at half its side, of thirty-two four.
  assert.equal(cacheTraceTiles(16, queue, 'full'), queue.probes)
  assert.equal(cacheTraceTiles(32, queue, 'full'), queue.probes * 4)
  assert.equal(
    cacheTraceTiles(8, queue, 'half'),
    queue.probes,
    'a map under sixteen texels is one tile',
  )
  assert.equal(cacheTraceTiles(16, queue, 'supersampled'), queue.probes * 4)
  // A full update holds the tiles of every probe at the whole side, whatever the tiles setting.
  assert.equal(cacheTraceTiles(16, queue, 'full', true), queue.probes * 4)
  assert.equal(cacheTraceTiles(16, queue, 'half', true), queue.probes * 4)
  // The trace atlas lays its tiles in rows of 512.
  assert.deepEqual(cacheTraceExtent(512), [4096, 8])
  assert.deepEqual(cacheTraceExtent(513), [4096, 16])
  assert.deepEqual(cacheTraceExtent(1), [4096, 8])
})

test('a cache holds its atlases, its tile list and its parameters and nothing else: no per-probe record rides beside the maps', () => {
  const pool = BOUNCE_SETTINGS.probePool
  const size = cacheExtent(16, pool)
  const finalSize = cacheExtent(cacheFinalSide(16, 1), pool)
  assert.equal(
    cacheBytes({ resolution: 16, mipmaps: 1, skyVisibility: false, light: 'r32uint' }, pool),
    textureBytesOf({ size, format: radianceCacheFormats('r32uint').raw })! +
      textureBytesOf({ size: finalSize, format: radianceCacheFormats('r32uint').final })! +
      listBytes(cacheTileCapacity(16, pool), 2) +
      RADIANCE_CACHE_PARAMS_BYTES,
  )
})

test('the cache’s parameters carry the levels of detail of the final maps, the row of the frame’s atlases, the tiles of the trace atlas and whether the frame is traced through it', () => {
  const settings = screenProbeSettings({ screenProbeRadianceCacheMipmaps: 3 })
  const P = RADIANCE_CACHE_PARAMS.at
  const written = (traced: boolean) => {
    const image = new ArrayBuffer(RADIANCE_CACHE_PARAMS_BYTES)
    writeCacheParams(settings, [0, 0, 0], image, {
      queue: { row: 64, probes: 64 * 43 },
      traceTiles: cacheTraceTiles(
        settings.cache.resolution,
        { row: 64, probes: 64 * 43 },
        settings.cache.tiles,
      ),
      traced,
    })
    return new Uint32Array(image)
  }
  const words = written(true)
  assert.equal(words[P.mipmaps], 3)
  assert.equal(words[P.tempRow], 64)
  assert.equal(
    words[P.traceTiles],
    cacheTraceTiles(settings.cache.resolution, { row: 64, probes: 64 * 43 }, settings.cache.tiles),
  )
  const flag = (traced: boolean, bit: number) => (written(traced)[P.flags] & bit) !== 0
  assert.deepEqual(
    [flag(true, RADIANCE_CACHE_FLAGS.traced), flag(false, RADIANCE_CACHE_FLAGS.traced)],
    [true, false],
  )
})

test('a full update traces the tiles of every probe at the whole side in the trace atlas, and the rest of its tiles (all at twice the side at the most) in further slices', () => {
  const queue = { row: 128, probes: 128 * 128 }
  for (const resolution of [16, 32]) {
    const atlas = cacheTraceTiles(resolution, queue, 'full', true)
    const slices = cacheTraceSlices(resolution, queue, atlas, true)
    assert.equal(slices, 4, `${resolution} texels`)
    // The slices hold every tile of the list, the most there is: the tiles at twice the side of every probe.
    assert.ok(slices * atlas >= queue.probes * (resolution / 4) ** 2)
  }
  // An update within its budget is traced whole; a map under sixteen texels is one tile a probe, whatever the level.
  assert.equal(cacheTraceSlices(16, queue, cacheTraceTiles(16, queue, 'full'), false), 1)
  assert.equal(cacheTraceSlices(8, queue, cacheTraceTiles(8, queue, 'full', true), true), 1)
  // The atlas is no taller than a texture every device takes (8192 texels, 512 tiles a row of 8).
  const huge = { row: 256, probes: 256 * 256 }
  const widest = cacheTraceTiles(64, huge, 'full', true)
  assert.equal(cacheTraceExtent(widest)[1] <= 8192, true)
  assert.ok(cacheTraceSlices(64, huge, widest, true) * widest >= huge.probes * 256)
})

test('the maps are made where the shape is chosen, and refused with the measurement where their final atlas is wider than the device’s textures', () => {
  const { device } = fakeDevice({
    limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
  })
  const wiring = { slots: 1 << 20 } as unknown as CacheWiring
  const cache = createRadianceCache(
    device,
    { light: 'r32uint', kernels: {} as CacheKernels },
    wiring,
    () => undefined,
  )
  cache.follow(screenProbeSettings(), 1)
  assert.match(
    cache.reason!,
    /bounce atlas "radiance cache" needs \d+×\d+ texels, over this device's maxTextureDimension2D of 8192/,
  )
  assert.equal(cache.views, undefined)
  assert.equal(cache.bytes, 0)
})
