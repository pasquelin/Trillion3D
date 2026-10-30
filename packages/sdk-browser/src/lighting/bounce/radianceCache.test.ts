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
  CACHE_PDF_WORDS,
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
import { createRadianceCache, tracedOf } from './cache/radianceCache.ts'
import { installGpuDeviceLedger } from '../../gpu/core/deviceLedger.ts'
import { cacheTraceBytes } from './cache/cacheLayout.ts'
import type { CacheKernels } from './cache/cacheKernels.ts'
import type { CacheWiring } from './cache/cacheGroups.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'
import {
  cacheLitRefusalWaits,
  cacheLitResourcesFor,
  cacheLitWordOf,
  cacheTraceSliceOf,
} from './cache/cacheHitLit.ts'
import {
  admitHitLit,
  cacheLitKernelsStep,
  followHitLit,
  cacheLitUndecided,
  litWordMoved,
  refuseHitLit,
  traceLitOrCards,
  type CacheLitHolder,
} from './cache/cacheLitState.ts'

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
    pool * CACHE_PDF_WORDS * 4 +
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

test('the atlases of a frame follow the queue’s block of probes: a square of the map a probe, rows of the queue’s width; the trace atlas holds the most tiles the list can hold, every probe cut to the finest level the lobes allow', () => {
  const queue = { row: 64, probes: 64 * 43 }
  assert.deepEqual(cacheTempExtent(16, queue), [64 * 16, 43 * 16])
  assert.deepEqual(cacheTempExtent(16, { row: 128, probes: 100 }), [128 * 16, 16])
  // A map of sixteen texels is at most sixteen tiles at twice its side (four per side), of thirty-two sixty-four.
  assert.equal(cacheTraceTiles(16, queue), queue.probes * 16)
  assert.equal(cacheTraceTiles(32, queue), queue.probes * 64)
  // The trace atlas lays its tiles in rows of 512.
  assert.deepEqual(cacheTraceExtent(512), [4096, 8])
  assert.deepEqual(cacheTraceExtent(513), [4096, 16])
  assert.deepEqual(cacheTraceExtent(1), [4096, 8])
})

test('a cache holds its atlases, its tile list, the sums of the lobes the screen probes want light in and its parameters and nothing else: no per-probe record rides beside the maps', () => {
  const pool = BOUNCE_SETTINGS.probePool
  const size = cacheExtent(16, pool)
  const finalSize = cacheExtent(cacheFinalSide(16, 1), pool)
  assert.equal(
    cacheBytes({ resolution: 16, mipmaps: 1, skyVisibility: false, light: 'r32uint' }, pool),
    textureBytesOf({ size, format: radianceCacheFormats('r32uint').raw })! +
      textureBytesOf({ size: finalSize, format: radianceCacheFormats('r32uint').final })! +
      listBytes(cacheTileCapacity(16, pool), 2) +
      pool * CACHE_PDF_WORDS * 4 +
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
      traceTiles: cacheTraceTiles(settings.cache.resolution, { row: 64, probes: 64 * 43 }),
      traced,
      lit: traced ? 0x1234 : 0,
      litExposure: 1,
    })
    return new Uint32Array(image)
  }
  const words = written(true)
  assert.equal(words[P.mipmaps], 3)
  assert.equal(words[P.tempRow], 64)
  assert.equal(
    words[P.traceTiles],
    cacheTraceTiles(settings.cache.resolution, { row: 64, probes: 64 * 43 }),
  )
  assert.equal(words[P.lit], 0x1234, 'the word the rays’ hits are lit with')
  assert.equal(written(false)[P.lit], 0)
  const flag = (traced: boolean, bit: number) => (written(traced)[P.flags] & bit) !== 0
  assert.deepEqual(
    [flag(true, RADIANCE_CACHE_FLAGS.traced), flag(false, RADIANCE_CACHE_FLAGS.traced)],
    [true, false],
  )
})

test('every update traces the tiles of its list in the trace atlas, the rest in further slices when the atlas cannot hold them all', () => {
  const queue = { row: 128, probes: 128 * 128 }
  for (const resolution of [16, 32]) {
    const atlas = cacheTraceTiles(resolution, queue)
    const slices = cacheTraceSlices(resolution, queue, atlas)
    assert.ok(slices * atlas >= queue.probes * (resolution / 4) ** 2)
  }
  // An atlas that holds the whole list is traced in one slice.
  assert.equal(
    cacheTraceSlices(16, { row: 64, probes: 64 }, cacheTraceTiles(16, { row: 64, probes: 64 })),
    1,
  )
  // The atlas is no taller than a texture every device takes (8192 texels, 512 tiles a row of 8).
  const huge = { row: 256, probes: 256 * 256 }
  const widest = cacheTraceTiles(64, huge)
  assert.equal(cacheTraceExtent(widest)[1] <= 8192, true)
  assert.ok(cacheTraceSlices(64, huge, widest) * widest >= huge.probes * 256)
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

const holder = (over: Partial<CacheLitHolder> = {}): CacheLitHolder => ({
  hitLit: undefined,
  litRefusal: undefined,
  litRefusedSets: new WeakSet(),
  litWord: undefined,
  litWanted: false,
  ...over,
})
const lists = () => {
  const calls: string[] = []
  return { calls, dispose: () => calls.push('disposed') } as never
}
/** Kernels that stand for one set, whose compile goes through the states a test names. */
const kernelsAt = (state: 'compiling' | 'refused' | 'ready') => ({
  ready: state === 'ready',
  pending: state === 'compiling',
})
const settle = (
  kernels: { ready: boolean; pending: boolean },
  state: Parameters<typeof kernelsAt>[0],
) => Object.assign(kernels, kernelsAt(state))

test('the probes are always updated: compiling kernels leave the cards word, never a held update, and a landing lights', () => {
  const h = holder()
  const k = kernelsAt('compiling')
  assert.equal(cacheLitKernelsStep(h, undefined, false), 'none', 'not asked')
  assert.equal(cacheLitKernelsStep(h, k, false), 'cards', 'the first compile does not hold')
  settle(k, 'refused')
  assert.equal(cacheLitKernelsStep(h, k, false), 'refused', 'the device refused them')
  settle(k, 'compiling')
  assert.equal(cacheLitKernelsStep(h, k, false), 'cards', 'the retry does not freeze the updates')
  settle(k, 'ready')
  assert.equal(cacheLitKernelsStep(h, k, false), 'lit', 'the retry landed')
  settle(k, 'compiling')
  assert.equal(cacheLitKernelsStep(h, k, false), 'cards', 'a later compile does not hold either')
  assert.equal(
    cacheLitKernelsStep(holder(), kernelsAt('ready'), true),
    'cards',
    'a refusal that waits keeps the cards',
  )
})

test('a set of kernels made anew answers on its own, whatever the sets before it did', () => {
  const h = holder()
  const first = kernelsAt('ready')
  assert.equal(cacheLitKernelsStep(h, first, false), 'lit')
  const second = kernelsAt('compiling')
  assert.equal(cacheLitKernelsStep(h, second, false), 'cards', 'compiling: the cards word')
  settle(second, 'ready')
  assert.equal(cacheLitKernelsStep(h, second, false), 'lit')
})

test('a refusal is recorded per set of kernels: another set refused is a refusal of its own', () => {
  const h = holder()
  const a = kernelsAt('refused')
  const b = kernelsAt('refused')
  assert.equal(cacheLitKernelsStep(h, a, false), 'refused')
  assert.equal(cacheLitKernelsStep(h, a, false), 'cards', 'recorded already')
  assert.equal(cacheLitKernelsStep(h, b, false), 'refused', 'the other set is not the first’s')
  assert.equal(cacheLitKernelsStep(h, a, false), 'cards', 'and the first stays recorded')
  settle(b, 'compiling')
  assert.equal(cacheLitKernelsStep(h, b, false), 'cards')
  settle(b, 'refused')
  assert.equal(cacheLitKernelsStep(h, b, false), 'refused', 'a new refusal of b after its retry')
  assert.equal(cacheLitKernelsStep(h, a, false), 'cards', 'a is untouched by b’s retry')
})

test('a refusal of the kernels is reported once per refusal, not each image they stay refused, wait or no wait', () => {
  const h = holder()
  const k = kernelsAt('refused')
  const steps = [false, false, false].map((waiting) => cacheLitKernelsStep(h, k, waiting))
  assert.deepEqual(steps, ['refused', 'cards', 'cards'], 'recorded once')
  settle(k, 'compiling')
  assert.equal(cacheLitKernelsStep(h, k, false), 'cards')
  settle(k, 'refused')
  assert.equal(cacheLitKernelsStep(h, k, false), 'refused', 'a new refusal after a retry')
  const waits = holder()
  assert.equal(
    cacheLitKernelsStep(waits, kernelsAt('refused'), true),
    'cards',
    'seen while a wait runs',
  )
})

test('the word flips once when the kernels land after a refusal, and not while the cards light the rays', () => {
  const h = holder()
  const k = kernelsAt('refused')
  const word = (step: string) => (step === 'lit' ? 0x77 : 0)
  const moves: boolean[] = []
  for (const state of ['refused', 'compiling', 'compiling', 'ready', 'ready'] as const) {
    settle(k, state)
    moves.push(litWordMoved(h, word(cacheLitKernelsStep(h, k, false))))
  }
  assert.deepEqual(moves, [false, false, false, true, false], 'one remade, when the retry lands')
})

test('a refusal (lists, marks, kernels) gives the lists back and keeps the wait of the refusals in a row; the kernels’ refusal goes through the same path', () => {
  const h = holder({ hitLit: lists() })
  const dropped = h.hitLit as unknown as { calls: string[] }
  refuseHitLit(h, 8, 1000)
  assert.deepEqual(dropped.calls, ['disposed'])
  assert.equal(h.hitLit, undefined)
  assert.equal(cacheLitRefusalWaits(h.litRefusal, 1000), true)
  const first = h.litRefusal!.refusal.refusals
  refuseHitLit(h, 8, 1000)
  assert.equal(h.litRefusal!.refusal.refusals, first + 1, 'the count carries to the next refusal')
  admitHitLit(h, 4)
  assert.ok(h.litRefusal, 'a smaller slice admitted keeps the count')
  admitHitLit(h, 8)
  assert.equal(h.litRefusal, undefined, 'the slice refused, admitted, clears it')
})

test('the hit lighting is given back when the settings no longer light the hits, with or without an update queued', () => {
  const h = holder({ hitLit: lists() })
  const dropped = h.hitLit as unknown as { calls: string[] }
  assert.equal(followHitLit(h, null, true), true, 'tells the host to give back its marks')
  assert.deepEqual(dropped.calls, ['disposed'], 'no hit lighting this image')
  const kept = holder({ hitLit: lists() })
  followHitLit(kept, undefined, false)
  assert.equal(kept.hitLit, undefined, 'the cache no longer casts through the triangles')
})

test('an image with no information about the hit lighting keeps the state, and the backoff', () => {
  const h = holder({ hitLit: lists() })
  refuseHitLit(h, 8, 1000)
  const refusal = h.litRefusal
  h.hitLit = lists()
  assert.equal(followHitLit(h, undefined, true), false, 'nothing to give back')
  assert.ok(h.hitLit, 'the lists are kept')
  assert.equal(h.litRefusal, refusal, 'the backoff is kept')
  assert.equal(cacheLitRefusalWaits(h.litRefusal, 1000), true)
  assert.equal(followHitLit(h, null, true), true, 'the settings say it is not wanted')
  assert.equal(h.litRefusal, undefined)
})

test('the lists are given back before the plain trace, so that their budget cannot refuse the plain atlas', () => {
  const h = holder({ hitLit: lists() })
  let held: unknown = 'unset'
  traceLitOrCards(
    h,
    8,
    1000,
    () => undefined,
    () => {
      held = h.hitLit
      return { splat: {} }
    },
  )
  assert.equal(held, undefined, 'no list held while the plain atlas is asked')
})

test('plain kernels not ready are a refusal of the hit lighting with a backoff; a plain atlas refused with ready kernels is not', () => {
  const run = (plainReady: boolean) => {
    const h = holder({ hitLit: lists() })
    const out = traceLitOrCards(
      h,
      8,
      1000,
      () => undefined,
      () => ({}),
      plainReady,
    )
    return { h, out }
  }
  const notReady = run(false)
  assert.equal(notReady.out.cards, true)
  assert.equal(cacheLitRefusalWaits(notReady.h.litRefusal, 1000), true, 'backed off')
  assert.equal(notReady.h.hitLit, undefined)
  const refusedAtlas = run(true)
  assert.equal(refusedAtlas.h.litRefusal, undefined, 'no backoff')
})

test('the maps are traced anew once per change of the word: compiling then landing is one remade, a refusal one backoff to the cards, and none while the word is unchanged', () => {
  const run = (states: readonly ('compiling' | 'refused' | 'ready')[]) => {
    const h = holder()
    const k = kernelsAt('compiling')
    let remades = 0
    for (const state of states) {
      settle(k, state)
      const step = cacheLitKernelsStep(h, k, false)
      if (litWordMoved(h, step === 'lit' ? 0x77 : 0)) remades++
    }
    return remades
  }
  assert.equal(run(['compiling', 'compiling', 'compiling', 'ready', 'ready', 'ready']), 1)
  assert.equal(
    run(['compiling', 'refused', 'refused', 'compiling']),
    0,
    'the cards word throughout',
  )
  assert.equal(run(['ready', 'ready']), 0, 'lit from the start: nothing to remake')
  assert.equal(run(['refused', 'compiling', 'ready']), 1, 'the landing after a refusal')
})

test('a marks texture refused records a refusal where the plain atlas fits; where it is refused too it is a budget refusal of the atlas, with no wait for the hit lighting', () => {
  const traces = (plainFits: boolean) => {
    const asked: string[] = []
    const h = holder({ hitLit: lists() })
    const out = traceLitOrCards(
      h,
      8,
      1000,
      () => {
        asked.push('lit')
        return undefined
      },
      () => {
        asked.push('plain')
        return { splat: plainFits ? {} : undefined }
      },
    )
    return { h, out, asked }
  }
  const fits = traces(true)
  assert.deepEqual(fits.asked, ['lit', 'plain'], 'lit tried, then plain')
  assert.equal(fits.out.cards, true)
  assert.equal(cacheLitRefusalWaits(fits.h.litRefusal, 1000), true, 'recorded')
  assert.equal(fits.h.hitLit, undefined, 'the lists were given back')
  const none = traces(false)
  assert.equal(none.out.cards, true)
  assert.equal(none.h.litRefusal, undefined, 'no backoff for the hit lighting')
  assert.equal(none.h.hitLit, undefined, 'the lists were given back')
  const admitted = holder()
  const ok = traceLitOrCards(
    admitted,
    8,
    1000,
    () => ({ lit: {} }),
    () => ({}),
  )
  assert.equal(ok.cards, false)
  assert.equal(admitted.litRefusal, undefined)
  const off = traceLitOrCards(admitted, 8, 1000, undefined, () => ({ splat: {} }))
  assert.deepEqual(off, { trace: { splat: {} }, cards: false })
})

test('a kernel refusal seen during another refusal’s wait is recorded once that wait ends', () => {
  const h = holder()
  const k = kernelsAt('refused')
  assert.equal(cacheLitKernelsStep(h, k, true), 'cards', 'seen while a wait runs')
  assert.equal(cacheLitKernelsStep(h, k, true), 'cards', 'still waiting')
  assert.equal(cacheLitKernelsStep(h, k, false), 'refused', 'the wait ended: recorded')
  assert.equal(cacheLitKernelsStep(h, k, false), 'cards', 'once')
})

test('the word follows what lit the probes: the hit lighting’s only where the lit path ran, the cards’ otherwise; a plain trace takes the lit slice while the mode is wanted', () => {
  const hit = {
    settings: { shadowMode: 1, direct: true, skylight: true, bounces: 1, refractions: 0 },
  } as never
  const word = cacheLitWordOf(hit, true)
  assert.equal(cacheLitWordOf(hit, false), 0, 'no scene trace, a disposed hold or the cards: 0')
  assert.equal(cacheLitWordOf(undefined, true), 0)
  assert.equal(litWordMoved(holder({ litWord: word }), cacheLitWordOf(hit, false)), true)
  assert.equal(cacheTraceSliceOf(true, 8, 64), 8, 'wanted: the lit slice for either trace')
  assert.equal(cacheTraceSliceOf(false, 8, 64), 64)
})

test('an undecided image between two lit images changes nothing, follow included: no remade, the lists kept, its update left for the next image; with the cache no longer casting through the triangles it is decided', () => {
  const lit = {
    settings: {
      probes: true,
      direct: true,
      skylight: true,
      shadowMode: 1,
      bounces: 1,
      refractions: 0,
    },
  } as never
  const h = holder()
  let remades = 0
  const image = (hit: unknown) => {
    if (cacheLitUndecided(h, hit as never, true)) return 'left'
    if (followHitLit(h, hit as never, true)) remades++
    if (litWordMoved(h, cacheLitWordOf(hit as never, true))) remades++
    return 'made'
  }
  assert.equal(image(lit), 'made')
  h.hitLit = lists()
  const lists0 = h.hitLit
  assert.equal(image(undefined), 'left', 'no information while the last decided wanted it')
  assert.equal(h.hitLit, lists0, 'the lists are kept')
  assert.equal(image(lit), 'made', 'the probes are traced on the next image')
  assert.equal(remades, 0, 'zero remade, the word never moved')
  assert.equal(image(null), 'made', 'the settings say no: decided, given back')
  assert.equal(h.hitLit, undefined)
  assert.equal(cacheLitUndecided(holder({ litWanted: true }), undefined, false), false)
  assert.equal(image(undefined), 'made', 'nothing was wanted: an undecided image is made as before')
})

/** One lit attempt as the update makes it, on a ledger of `limit` bytes: the marked atlas first, the lists once it is held, the plain trace after a refusal. */
function litAttempt(limit: number) {
  const { device } = fakeDevice()
  installGpuDeviceLedger(device, { limit: () => limit })
  const calls = { admit: 0 }
  const group = () => ({})
  const state = {
    ...holder(),
    device,
    traceAtlas: undefined,
    temp: undefined,
    smallTemp: 0,
    smallTrace: 0,
    tracedGroups: group,
    splatGroup: group,
    litGroups: group,
  } as unknown as Parameters<typeof tracedOf>[0]
  const storage = { shape: { light: WORD_LIGHT_FORMAT } } as never
  const traced = (hitLit: boolean) => ({ hitLit, pipeline: () => 'pipeline' }) as never
  const lit = {
    kernels: { traced: traced(true) } as never,
    hit: {} as never,
    admit: () => {
      calls.admit++
      return (state.hitLit = cacheLitResourcesFor(device, state.hitLit, 8))
    },
  }
  const through = (marked: boolean) =>
    tracedOf(
      state,
      {} as never,
      storage,
      {} as never,
      {} as never,
      traced(marked),
      8,
      marked ? lit : undefined,
    )
  const out = traceLitOrCards(
    state,
    8,
    1000,
    () => through(true),
    () => through(false) ?? ({} as { splat?: unknown; lit?: unknown }),
  )
  return { state, out, calls }
}

test('the lit attempt asks the marked atlas before the lists: a tight budget where the plain atlas fits alone traces plain at once, with no list made', () => {
  const out = litAttempt(cacheTraceBytes(8, WORD_LIGHT_FORMAT) + 1)
  assert.equal(out.calls.admit, 0, 'no list allocated')
  assert.equal(out.state.hitLit, undefined)
  assert.ok(out.out.trace.splat, 'the plain trace went through the triangles on the first image')
  assert.equal(out.out.cards, true)
  assert.equal(
    cacheLitRefusalWaits(out.state.litRefusal, 1000),
    true,
    'the marks refusal is recorded',
  )
})

test('the plain atlas refused too: no list allocation and no wait for the hit lighting', () => {
  const out = litAttempt(1)
  assert.equal(out.calls.admit, 0)
  assert.equal(out.state.litRefusal, undefined)
})

test('the lists refused after the marked atlas is held: the held atlas serves the plain trace and the refusal is recorded', () => {
  const out = litAttempt(cacheTraceBytes(8, WORD_LIGHT_FORMAT, true) + 1)
  assert.equal(out.calls.admit, 1)
  assert.equal(out.state.hitLit, undefined)
  assert.ok(out.out.trace.splat)
  assert.ok(out.state.traceAtlas?.marks, 'the marked atlas is the one traced into')
  assert.equal(cacheLitRefusalWaits(out.state.litRefusal, 1000), true)
})

test('room for both: the lit trace runs with its lists', () => {
  const out = litAttempt(1e12)
  assert.equal(out.out.cards, false)
  assert.ok(out.out.trace.lit)
  assert.ok(out.state.hitLit)
})

test('the cache reports an image undecided only after a decision that wanted the hit lighting, and decided again once the settings no longer cast through the triangles', () => {
  const { device } = fakeDevice({
    limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
  })
  const cache = createRadianceCache(
    device,
    { light: 'r32uint', kernels: {} as CacheKernels },
    { slots: 1 << 20 } as unknown as CacheWiring,
    () => undefined,
  )
  const on = screenProbeSettings({ screenProbeRadianceCacheHardwareRayTracing: true })
  const off = screenProbeSettings({ screenProbeRadianceCacheHardwareRayTracing: false })
  const lit = {
    settings: {
      probes: true,
      direct: true,
      skylight: true,
      shadowMode: 1,
      bounces: 1,
      refractions: 0,
    },
  } as never
  assert.equal(cache.undecided(on, undefined), false, 'nothing decided yet')
  cache.follow(on, 1, lit)
  assert.equal(cache.undecided(on, undefined), true, 'wanted, no information')
  assert.equal(cache.undecided(on, lit), false)
  assert.equal(cache.undecided(off, undefined), false, 'not casting through the triangles')
  cache.follow(on, 1, null)
  assert.equal(cache.undecided(on, undefined), false, 'the settings said no')
})
