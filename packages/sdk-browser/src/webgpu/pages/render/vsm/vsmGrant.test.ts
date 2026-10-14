// A shadow set the device refuses is drawn again at half its bytes, the one rule of every pool
// (`halvings`, `../../../../residency/outOfMemory.ts`): the lights keep casting, coarser, where they
// used to read no shadow until they changed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../../../sdk-core/src/scene/light/store.ts'
import { SUN } from '../../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts'
import { installGpuGlobals } from '../../../../../../../tests/kit/gpu/globals.ts'
import { BACKEND } from '../../../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../../../tests/kit/gpu/fakeDevice.ts'
import { SHADOW_LIMITS, camera, disposeQuadRun, quadBackend } from '../../testScenes.fixture.ts'

/** The first window of the first physical pool slice: its size follows the pool's pages. */
const POOL = 'vsm.physicalPool0.0'

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
