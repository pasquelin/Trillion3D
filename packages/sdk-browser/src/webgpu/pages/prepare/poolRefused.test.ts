import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { quadBackend } from '../testScenes.fixture.ts'
import { setWebgpuMemoryBudgets } from '../io/memory.ts'
import { texturePoolFor } from '../../residency/memoryBudgets.ts'
import { laneCounts, poolEncoding } from '../../../texture/blockFormats.ts'
import { noTails } from '../../../texture/noTails.fixture.ts'
import type { EngineDiagnostic } from '../../../engine/types.ts'
import { refusing } from './refusing.fixture.ts'

test('a texture pool refused even at its floor at prepare is refused by name, never allocated in full', async () => {
  installGpuGlobals()
  const { device, textures } = refusing('createTexture', 'texture pool')
  const events: EngineDiagnostic[] = []
  const { fixture, backend } = quadBackend(device, {
    onDiagnostic: (event: EngineDiagnostic) => events.push(event),
  })
  try {
    await assert.rejects(backend.prepare(), /WEBGPU_TEXTURE_POOL_REFUSED/)
    const failure = events.find((event) => event.phase === 'material-pipeline-failed')
    assert.match(String(failure?.context.error), /WEBGPU_TEXTURE_POOL_REFUSED/)
    const pools = textures.filter((texture) => texture.label?.startsWith('Trillion3D texture pool'))
    assert.ok(pools.length > 0)
    assert.ok(
      pools.every((texture) => texture.destroyed),
      'every pool the device refused is released; none is made outside the scope',
    )
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('a geometry pool refused even at its root cover at prepare is refused by name', async () => {
  installGpuGlobals()
  const { device } = refusing('createBuffer', 'geometry page cache')
  const { fixture, backend } = quadBackend(device)
  try {
    await assert.rejects(backend.prepare(), /WEBGPU_GEOMETRY_POOL_REFUSED/)
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('a geometry concatenation that fails at prepare refuses the scene, said once, never another image', async () => {
  installGpuGlobals()
  const gpu = mockGpu()
  const device = gpu.device as unknown as Record<string, (d: { label?: string }) => unknown>
  const make = device.createBuffer
  device.createBuffer = function (this: unknown, descriptor: { label?: string }) {
    if (descriptor.label?.startsWith('Trillion3D transparent geometry'))
      throw new RangeError('refused')
    return make.call(this, descriptor)
  }
  const events: EngineDiagnostic[] = []
  const { fixture, backend } = quadBackend(gpu.device, {
    onDiagnostic: (event: EngineDiagnostic) => events.push(event),
  })
  try {
    await assert.rejects(backend.prepare(), /refused/)
    const failures = events.filter((event) => event.phase === 'material-pipeline-failed')
    assert.equal(failures.length, 1)
    assert.match(String(failures[0].context.error), /refused/)
    assert.equal(
      events.some((event) => event.phase === 'render-capabilities'),
      false,
      'no image path is declared ready',
    )
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('the texture budget recorded mid-session is the one the device granted, not the one asked', async () => {
  const encoding = poolEncoding(undefined)
  const lanes = { ...laneCounts(), lossless: 20_000 }
  const poolFor = (bytes: number) =>
    texturePoolFor(bytes, undefined, { color: lanes, data: lanes }, encoding.texelBytes, noTails)
  const asked = 512 * 1024 * 1024,
    wanted = poolFor(asked)
  const layerBytes = wanted.allocatedBytes / (2 * wanted.layers.color.lossless)
  // Room for two layers per atlas, not for what the budget asks.
  const gpu = fakeDevice({
    limits: {},
    refuse: ({ size }) => {
      const { width, height = 1, depthOrArrayLayers = 1 } = size as GPUExtent3DDict
      return width * height * depthOrArrayLayers * 4 > 2 * layerBytes ? 'oom' : undefined
    },
  })
  const setup = {
    texturePoolBudget: 1,
    texturePools: { encoding, poolFor, pool: poolFor(1) },
  }
  const rt = {
    setup,
    gpu: { device: gpu.device },
    vis: {
      textures: {
        color: { pools: [] },
        data: { pools: [] },
        resize: () => 0,
        sources: { liveBytes: 0 },
      },
    },
    run: { lost: false, gate: { resourcesChanged() {} } },
    diag: { engineDiagnostic() {} },
  }
  const report = await setWebgpuMemoryBudgets(rt as never, { texturePoolBytes: asked })
  assert.ok(report.texturePool && report.texturePool.budgetBytes < asked)
  assert.equal(setup.texturePoolBudget, report.texturePool.budgetBytes)
})
