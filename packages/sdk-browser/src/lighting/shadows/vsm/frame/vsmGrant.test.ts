// A shadow set the device refuses is drawn again at half its bytes, the one rule of every pool
// (`halvings`, `../../../../session/memory/outOfMemory.ts`): the lights keep casting, coarser, where they
// used to read no shadow until they changed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../../../sdk-core/src/scene/light/store.ts'
import type { ShadowOptions } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { SUN } from '../../../../../../sdk-core/src/scene/light/shadow/lightShadow.fixture.ts'
import { installGpuGlobals } from '../../../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  SHADOW_LIMITS,
  camera,
  disposeQuadRun,
  quadBackend,
  quadScene,
} from '../../../../frame/backend/testScenes.fixture.ts'
import { webgpuPagesEngine } from '../../../../frame/backend/pages.ts'
import { createTextureCaches } from '../../../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../../../geometry/streaming/pageCache.ts'
import { VsmCacheManager } from '../cacheManager.ts'
import { dropEngineVsmCache, type EngineVsm } from './engineVsm.ts'
import { createVsmEngineStats } from './vsmStats.ts'
import { createVsmSettle } from '../../../../frame/backend/state/vsmSettle.ts'
import { createVsmProjectionHold } from './vsmProjectionHold.ts'

/** The first physical pool slice: its size follows the pool's pages. */
const POOL = 'vsm.physicalPool0'
const MIB = 2 ** 20
/** A device whose binding and buffers hold the largest pool: 512 MiB a slice. */
const ROOMY_LIMITS = {
  ...SHADOW_LIMITS,
  maxBufferSize: 1024 * MIB,
  maxStorageBufferBindingSize: 512 * MIB,
}

test('the device refuses the full shadow set: a halved pool is granted, and the sun casts', async () => {
  installGpuGlobals()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const said: string[] = []
  const { fixture, backend } = quadBackend(gpu.device, {
    sceneLights,
    onDiagnostic: (event) => void said.push(event.phase),
  })
  const device = gpu.device as GPUDevice
  const create = device.createBuffer.bind(device)
  const pools: { size: number; refused: boolean }[] = []
  device.createBuffer = (descriptor) => {
    if (descriptor.label?.startsWith(POOL)) {
      // The first set's pool is refused, as a device out of memory would refuse it.
      const refused = pools.length === 0
      pools.push({ size: descriptor.size, refused })
      if (refused) throw new Error('out of memory')
    }
    return create(descriptor)
  }
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    assert.ok(pools.length >= 2, 'the refused set is asked again, smaller')
    assert.ok(pools[1].size < pools[0].size, 'at half its bytes or less')
    assert.ok(backend.metrics().shadowVsmLights, 'the sun casts')
    assert.ok(said.includes('gpu-out-of-memory'), 'the shrink is said')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a set the device refuses in its verdict alone is held until it comes, then drawn at half', async () => {
  installGpuGlobals()
  const pools: number[] = []
  const gpu = fakeDevice({
    ...BACKEND,
    limits: SHADOW_LIMITS,
    // The first set's pool is made, and an out-of-memory error left in the scope it is made in.
    refuse: (descriptor) =>
      descriptor.label?.startsWith(POOL) &&
      pools.push((descriptor as GPUBufferDescriptor).size) === 1
        ? 'oom'
        : undefined,
  })
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const said: string[] = []
  const { fixture, backend } = quadBackend(gpu.device, {
    sceneLights,
    onDiagnostic: (event) => void said.push(event.phase),
  })
  try {
    await backend.prepare()
    backend.render(camera())
    assert.equal(pools.length, 1, "the frame holds the set at once: the device's verdict is later")
    await backend.flush()
    backend.render(camera())
    await backend.flush()
    assert.ok(pools.length >= 2, 'the refused set is asked again')
    assert.ok(pools[1] < pools[0], 'at half its bytes or less')
    assert.ok(backend.metrics().shadowVsmLights, 'the sun casts')
    assert.ok(said.includes('gpu-out-of-memory'), 'the shrink is said')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('the most physical pages the setting names is the pool, rounded up to a whole row of 128 pages', async () => {
  const pool = async (settings: ShadowOptions, limits = ROOMY_LIMITS) => {
    installGpuGlobals()
    const gpu = fakeDevice({ ...BACKEND, limits })
    const sceneLights = createSceneLightStore()
    sceneLights.add(SUN)
    const options = { sceneLights, viewport: [2048, 2048] as [number, number], renderScale: 1 }
    const { fixture, backend } = quadBackend(gpu.device, { ...options, ...settings })
    try {
      await backend.prepare()
      backend.render(camera())
      await backend.flush()
      return gpu.buffers.find((buffer) => buffer.label?.startsWith(POOL))!.size
    } finally {
      disposeQuadRun(backend, fixture)
    }
  }
  const asked = await pool({})
  assert.equal(asked, 256 * MIB, 'the default level: 4096 pages, 256 MiB a slice')
  assert.equal(await pool({ shadowMaxPhysicalPages: 4096 }), asked, 'the default is the most')
  const capped = await pool({ shadowMaxPhysicalPages: 512 })
  assert.equal(capped, 32 * MIB, '512 pages')
  assert.equal(await pool({ shadowMaxPhysicalPages: 700 }), 48 * MIB, '700 reads as 768: six rows')
})

// The pool is the setting's, whatever the view (the reference sizes it from its setting alone): a
// device holds the pages its binding allows, no more.
test('a device whose binding holds fewer pages than the setting names holds the largest pool that fits', async () => {
  installGpuGlobals()
  const sizes: number[] = []
  for (const limits of [SHADOW_LIMITS, ROOMY_LIMITS]) {
    const gpu = fakeDevice({ ...BACKEND, limits })
    const sceneLights = createSceneLightStore()
    sceneLights.add(SUN)
    const options = { sceneLights, viewport: [2048, 2048] as [number, number], renderScale: 1 }
    const { fixture, backend } = quadBackend(gpu.device, {
      ...options,
      shadowMaxPhysicalPages: 8192,
    })
    try {
      await backend.prepare()
      backend.render(camera())
      await backend.flush()
      sizes.push(gpu.buffers.find((buffer) => buffer.label?.startsWith(POOL))!.size)
      assert.ok(backend.metrics().shadowVsmLights, 'the sun casts')
    } finally {
      disposeQuadRun(backend, fixture)
    }
  }
  assert.deepEqual(
    sizes,
    [128 * MIB, 512 * MIB],
    '2048 pages on a 128 MiB binding, the 8192 the setting names beyond',
  )
})

/** The sun's shadow set of a quality that toggles 3 -> 0 -> 5, with `mode` for what quality 0 does
 *  with the set held (`shadowDynamicDeallocationMode`). */
async function toggleQuality(mode: number) {
  installGpuGlobals()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const fixture = quadScene()
  const context = {
    ...{ textureCaches: createTextureCaches(createPageCache()), ...fixture },
    ...{ gpuDevice: gpu.device, maxResidentPages: 2, viewport: [32, 32] as [number, number] },
    // A small pool: the set is made, freed and made again, each time in the fake device's memory.
    ...{ sceneLights, shadowQuality: 0, shadowMaxPhysicalPages: 512 },
    ...{ shadowDynamicDeallocationMode: mode },
  }
  const backend = webgpuPagesEngine(context)
  const pools = () => gpu.buffers.filter((buffer) => buffer.label?.startsWith(POOL)).length
  const freed = () => gpu.destroyed.filter((made) => made.label?.startsWith(POOL)).length
  const frame = async () => {
    backend.render(camera())
    await backend.flush()
    return backend.metrics().shadowVsmLights
  }
  try {
    await backend.prepare()
    assert.equal(await frame(), null, 'quality 0: the sun takes no map')
    assert.equal(pools(), 0, 'and no pool is made')
    context.shadowQuality = 3
    assert.ok(await frame(), 'quality 3: the sun casts')
    const made = pools()
    assert.ok(made > 0, 'a pool is made for it')
    context.shadowQuality = 0
    // Freed (mode 1): no set, no count. Kept (0 and 2): the set counts no light.
    assert.equal(await frame(), mode === 1 ? null : 0, 'back to 0: no map')
    const freedAtZero = freed()
    context.shadowQuality = 5
    assert.ok(await frame(), 'quality 5: the sun casts again')
    return { made, freedAtZero, alive: pools() - freed() }
  } finally {
    disposeQuadRun(backend, fixture)
  }
}

test('shadowQuality 0 makes no shadow set; mode 1 frees the one held, any level above it shadows the sun again from a set of its own', async () => {
  const { made, freedAtZero, alive } = await toggleQuality(1)
  assert.equal(freedAtZero, made, 'every pool made is freed, the one held with its cache')
  assert.equal(alive, 1, 'one pool alive: a new one, the first not reused')
})

test('shadowQuality 0 under mode 0 or 2 keeps the set held, and the sun casts again from it', async () => {
  for (const mode of [0, 2]) {
    const { made, freedAtZero, alive } = await toggleQuality(mode)
    assert.equal(freedAtZero, 0, `mode ${mode}: no pool freed at quality 0`)
    assert.equal(alive, made, `mode ${mode}: the pools made are the ones alive, none made again`)
  }
})

test('a set kept while no light shadows drops its cache, forgets its plan and counts, and a repeat leaves the same state', () => {
  const cache = new VsmCacheManager()
  const entry = cache.lightEntryFor('sun', 1)
  entry.markRendered(5)
  cache.keepFrameForNext({ mapCount: 1, sunBase: 0 })
  const stats = Object.assign(createVsmEngineStats(), {
    ...{ lights: 2, maps: 5, tableBlocks: 1, projectionPasses: 2, freePages: 7 },
    ...{ invalidationThreads: 40, pressureBiasStat: 1, render: {} },
  })
  const settle = createVsmSettle()
  settle.landedRendered = 2
  const hold = createVsmProjectionHold()
  const mask = {}
  hold.held(mask)
  hold.keep()
  const vsm = {
    stats,
    settle,
    projectionHold: hold,
    state: { cache },
    res: { prevFrameKept: true, occlusion: undefined },
    plan: {},
    renderedPlan: {},
    pendingBoxes: {},
    pendingDiff: {},
    pendingCastMaps: {},
  }
  assert.ok(hold.held(mask), 'the projection ran from these inputs')
  assert.ok(cache.hasPreviousFrame() && !entry.isInvalidated())
  const dropped = () => ({
    previous: cache.hasPreviousFrame(),
    invalidated: entry.isInvalidated(),
    entries: cache.entries.size,
    kept: vsm.res.prevFrameKept,
    held: hold.held(mask),
    plan: [vsm.plan, vsm.renderedPlan],
    pending: [vsm.pendingBoxes, vsm.pendingDiff, vsm.pendingCastMaps],
    stats: { ...vsm.stats },
  })
  for (const drop of [1, 2]) {
    dropEngineVsmCache(vsm as unknown as EngineVsm, 10 + drop)
    assert.deepEqual(
      dropped(),
      {
        ...{ previous: false, invalidated: true, entries: 1, kept: false, held: false },
        ...{ plan: [undefined, undefined], pending: [null, null, null] },
        stats: createVsmEngineStats(),
      },
      `drop ${drop}: the cache dropped, the light drawn uncached, nothing planned, nothing counted`,
    )
    assert.equal(vsm.stats, stats, 'the counts are zeroed in place')
    assert.deepEqual(
      [settle.landedFrame, settle.landedRendered],
      [10 + drop, 0],
      'the idle frame settles it at once',
    )
  }
})

test('shadowCache and shadowUseReceiverMaskLocal change the set the sun is drawn from: another is made, the first freed with its cache', async () => {
  installGpuGlobals()
  for (const [setting, value] of [
    ['shadowCache', false],
    ['shadowUseReceiverMaskLocal', true],
  ] as const) {
    const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
    const sceneLights = createSceneLightStore()
    sceneLights.add(SUN)
    const fixture = quadScene()
    const context: Record<string, unknown> = {
      ...{ textureCaches: createTextureCaches(createPageCache()), ...fixture },
      ...{ gpuDevice: gpu.device, maxResidentPages: 2, viewport: [32, 32] as [number, number] },
      ...{ sceneLights, shadowQuality: 3, shadowMaxPhysicalPages: 512 },
    }
    const backend = webgpuPagesEngine(context as unknown as Parameters<typeof webgpuPagesEngine>[0])
    const pools = () => gpu.buffers.filter((buffer) => buffer.label?.startsWith(POOL)).length
    const freed = () => gpu.destroyed.filter((made) => made.label?.startsWith(POOL)).length
    const frame = async () => {
      backend.render(camera())
      await backend.flush()
      return backend.metrics().shadowVsmLights
    }
    try {
      await backend.prepare()
      assert.ok(await frame(), `${setting}: the sun casts`)
      const made = pools()
      assert.ok((await frame()) && pools() === made && freed() === 0, 'the set is kept as it is')
      context[setting] = value
      assert.ok(await frame(), `${setting} ${value}: the sun casts`)
      assert.equal(freed(), made, 'the first set is freed whole')
      assert.equal(pools() - freed(), made, 'and another made')
    } finally {
      disposeQuadRun(backend, fixture)
    }
  }
})
