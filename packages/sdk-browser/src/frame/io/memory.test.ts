import { MIB } from '../../../../math/src/constants.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { camera, quadBackend } from '../backend/testScenes.fixture.ts'
import { followTexturePressure, setWebgpuMemoryBudgets } from './memory.ts'
import { geometryPoolFor } from '../../session/memory/pools.ts'
import { texturePoolFor } from '../../geometry/residency/memoryBudgets.ts'
import {
  laneCounts,
  poolEncoding,
  type AtlasLanes,
  type PoolLane,
} from '../../materials/texture/blockFormats.ts'
import { noTails } from '../../materials/texture/noTails.fixture.ts'
import { RETRY_MS } from '../../gpu/core/backoff.ts'

// The engine changes pools mid-session — what an application slider calls — without preparing
// again and without losing the image: the report says what it actually holds.
test('setMemoryBudgets sets the pools in session, brings them back by name, and the image continues', async () => {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  // Two 12-byte root pages, the root cover: a budget under a streaming slot leaves the pool that
  // cover alone, which no budget pays for.
  const { fixture, backend } = quadBackend(device, {
    maxResidentPages: undefined,
    geometryPoolBytes: 1,
  })
  try {
    await backend.prepare()
    backend.render(camera())
    const before = backend.metrics()
    assert.deepEqual(
      [before.geometryPoolBytes, before.geometryPoolSlots, before.geometryPoolClamp],
      [1, 2, 'root-cover'],
    )
    // More than the scene has pages: brought back to the scene, by name, nothing is evicted.
    const grown = await backend.setMemoryBudgets!({ geometryPoolBytes: 1024 * MIB })
    assert.deepEqual([grown.geometryPool.clamp, grown.geometryPool.slots], ['scene', 2])
    assert.equal(grown.evictedPages, 0)
    // A budget of no slot: the root cover alone, by name; roots never leave.
    const shrunk = await backend.setMemoryBudgets!({ geometryPoolBytes: 1, texturePoolBytes: 1 })
    assert.equal(shrunk.geometryPool.clamp, 'root-cover')
    // The quad has no map: no texture layer at any budget, nothing raised to a floor.
    assert.equal(shrunk.texturePool?.clamp, null)
    assert.equal(shrunk.texturePool?.layers.color.lossless, 0)
    assert.ok(shrunk.durationMs >= 0)
    backend.render(camera())
    const after = backend.metrics()
    assert.equal(after.geometryPoolSlots, shrunk.geometryPool.slots)
    assert.equal(after.geometryPoolClamp, 'root-cover')
    assert.equal(after.coverageReady, true)
    assert.equal(after.texturePoolClamp, null)
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('a setting above the scene is brought back to its pages, and the cache resized once', async () => {
  const resized: number[] = []
  let resources = 0
  const setup = {
    cap: 4,
    geometryPool: { slots: 2 },
    texturePool: { layers: 1 },
    gpuDevice: fakeDevice({ limits: {} }).device,
    geometryPoolFor: (budgetBytes: number) =>
      geometryPoolFor({
        budgetBytes,
        pageBytes: 8,
        uniquePages: 4,
        rootPages: 1,
      }),
    get slots() {
      return this.geometryPool.slots
    },
  }
  const rt = {
    setup,
    gpu: {
      cache: {
        resize: async (n: number) => (resized.push(n), ['p']),
        stats: () => ({ residentPages: 3 }),
      },
    },
    vis: {},
    run: { lost: false, gate: { resourcesChanged: () => resources++ } },
    diag: { engineDiagnostic() {} },
  }
  const report = await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 800 })
  assert.deepEqual([report.geometryPool.clamp, report.geometryPool.slots], ['scene', 4])
  assert.deepEqual(resized, [4])
  assert.equal(report.evictedPages, 1)
  assert.deepEqual(report.residentPages, { before: 3, after: 3 })
  assert.equal(setup.slots, 4)
  assert.equal(resources, 1)
  // The same value again: nothing to resize.
  await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 800 })
  assert.deepEqual(resized, [4])
})

// Behaviour: a texture budget set before prepare is kept, not drawn — the lane pools need the
// catalogue —, the report says so with `null`, and prepare draws the pools at that budget.
test('a texture budget set before prepare is kept and drawn by prepare, the report saying null', async () => {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  const { fixture, backend } = quadBackend(device, { maxResidentPages: undefined })
  try {
    const early = await backend.setMemoryBudgets!({ texturePoolBytes: 1 })
    assert.equal(early.texturePool, null)
    assert.equal(backend.metrics().texturePoolClamp, null)
    await backend.prepare()
    backend.render(camera())
    // Drawn at the one-byte budget: no layer, the quad having no map.
    const after = await backend.setMemoryBudgets!({})
    assert.equal(after.texturePool?.budgetBytes, 1)
    assert.equal(after.texturePool?.allocatedBytes, 0)
    await assert.rejects(
      backend.setMemoryBudgets!({ texturePoolBytes: 0 }),
      /INVALID_TEXTURE_POOL_BUDGET/,
    )
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

// Out of memory absorbed: a pool the device refuses is drawn smaller, the pool in place replaced
// only by one it grants, a diagnostic names the pool and the bytes, and nothing reaches the page.
test('a geometry pool the device refuses mid-session shrinks, and the session goes on', async () => {
  const gpu = fakeDevice({
    limits: {},
    refuse: ({ size }) => ((size as number) > 16 ? 'oom' : undefined),
  })
  const resized: number[] = [],
    diagnostics: Array<[string, Record<string, unknown>]> = []
  // The pool in place: the root's slot alone, no streaming slot.
  const setup = {
    geometryPool: geometryPoolFor({ budgetBytes: 1, pageBytes: 8, uniquePages: 100, rootPages: 1 }),
    geometryPoolFor: (budgetBytes: number) =>
      geometryPoolFor({ budgetBytes, pageBytes: 8, uniquePages: 100, rootPages: 1 }),
    get slots() {
      return this.geometryPool.slots
    },
  }
  const run = { lost: false, gate: { resourcesChanged() {} } }
  const rt = {
    setup,
    gpu: {
      device: gpu.device,
      cache: { resize: async (n: number) => (resized.push(n), []), stats: () => ({}) },
    },
    vis: {},
    run,
    diag: {
      engineDiagnostic: (phase: string, _message: string, context: Record<string, unknown>) =>
        diagnostics.push([phase, context]),
    },
  }
  const report = await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 64 })
  // 64, 32, 16 then 8 bytes of streaming slots beside the root's 8: 72 → 40 → 24 → 16 bytes, two
  // slots, what the device grants.
  assert.deepEqual(resized, [2])
  assert.equal(report.geometryPool.slots, 2)
  assert.equal(run.lost, false)
  assert.deepEqual(diagnostics[0], [
    'gpu-out-of-memory',
    { kind: 'warning', pool: 'geometry', requestedBytes: 72, grantedBytes: 16, clamp: null },
  ])
  assert.equal(gpu.scopes.length, 0)
})

// The texture pool is made at its floors and grows where a lane runs out of places
// (`followTexturePressure`): a pressed lane grows a layer at each image it is short, within the
// share its budget gives it, the tiles kept; a growth the device refuses keeps the pool in place
// and waits for its retry.
test('a lane that ran out of places grows a layer at a time within the budget, a refused growth waits', async (t) => {
  // The wait is time (`refusalNow`), advanced by hand.
  let clock = 1_000_000
  t.mock.method(performance, 'now', () => clock)
  t.mock.method(Math, 'random', () => 0.5)
  const encoding = poolEncoding(undefined),
    budget = 512 * MIB
  // 20 000 tiles to stream: the budget's share is four layers a lane, the floor one.
  const demand = { color: { ...laneCounts(), lossless: 20_000 }, data: laneCounts() }
  const poolFor = (bytes: number, held?: AtlasLanes) =>
    texturePoolFor(bytes, undefined, demand, encoding.texelBytes, noTails, held)
  const floors = { color: laneCounts(), data: laneCounts() }
  const pools = { encoding, poolFor, pool: poolFor(budget, floors), growing: undefined }
  assert.equal(pools.pool.layers.color.lossless, 1)
  const refused = { value: false }
  const gpu = fakeDevice({
    limits: {},
    refuse: (descriptor) =>
      refused.value && descriptor.label === 'Trillion3D pool probe' ? 'oom' : undefined,
  })
  const pressed: PoolLane[] = [],
    resized: AtlasLanes[] = [],
    phases: string[] = []
  let changes = 0
  const run = { lost: false, frame: 0, gate: { resourcesChanged: () => changes++ } }
  const rt = {
    setup: { texturePoolBudget: budget, texturePools: pools },
    gpu: { device: gpu.device },
    vis: {
      textures: {
        color: { takePressure: () => pressed.splice(0) },
        data: { takePressure: () => [] },
        resize: (layers: AtlasLanes) => (resized.push(layers), 0),
        sources: { liveBytes: 0 },
      },
    },
    run,
    layout: {},
    signal: new AbortController().signal,
    diag: { engineDiagnostic: (phase: string) => phases.push(phase), diagnosticFailure() {} },
  }
  const press = async () => {
    pressed.push('lossless')
    await followTexturePressure(rt as never)
  }
  await press()
  assert.equal(pools.pool.layers.color.lossless, 2, 'one layer more')
  assert.deepEqual([resized.length, changes, phases], [1, 1, ['texture-pool-grown']])
  await press()
  await press()
  assert.equal(pools.pool.layers.color.lossless, 4, 'within the share: four layers, no more')
  await press()
  assert.equal(resized.length, 3, 'a lane at its share asks nothing more')
  // A growth the device refuses: the pool in place, the refusal waiting before the next ask.
  pools.pool = poolFor(budget, floors)
  refused.value = true
  await press()
  assert.equal(pools.pool.layers.color.lossless, 1)
  const probes = () => gpu.textures.filter(({ label }) => label === 'Trillion3D pool probe').length
  const asked = probes()
  clock += RETRY_MS / 10
  await press()
  assert.equal(probes(), asked, 'not asked again every image')
  clock += RETRY_MS
  refused.value = false
  await press()
  assert.equal(pools.pool.layers.color.lossless, 2, 'asked again once its wait is over')
})
