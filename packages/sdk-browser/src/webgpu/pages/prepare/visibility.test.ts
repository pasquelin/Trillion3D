import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareWebgpuVisibility } from './visibility.ts'
import { mountDevice } from '../../water/pass.fixture.ts'
import type { BlendGpuItem } from '../../blend/state.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { colorBytesPerSample } from '../../../gpu/core/colorBytes.fixture.ts'

const STOP = new Error('past the blend pipelines')

/** A device granted `limit` colour bytes per sample that refuses a wider pipeline, as WebGPU does. */
function deviceGranted(limit: number) {
  const mount = mountDevice()
  const create = mount.device.createRenderPipelineAsync
  Object.assign(mount.device, {
    limits: { maxColorAttachmentBytesPerSample: limit },
    createRenderPipelineAsync: async (descriptor: GPURenderPipelineDescriptor) => {
      const formats = [...(descriptor.fragment?.targets ?? [])].map((target) => target?.format)
      if (colorBytesPerSample(formats) > limit) throw new Error('maxColorAttachmentBytesPerSample')
      return create(descriptor)
    },
  })
  return mount.device
}

/** The water diagnostics of preparing one transmissive blend on `device`; the stub stops the
 *  preparation right after the blend pipelines. */
async function waterFailures(device: GPUDevice) {
  const failures: string[] = []
  const blendGpu = [{ transmissive: true, surface: { blending: 'normal' } }] as BlendGpuItem[]
  const rt = {
    vis: {},
    capabilities: {},
    diag: { diagnosticFailure: (code: string) => failures.push(code) },
    blendState: { blendGpu },
    layout: { drawSlots: 1 },
    setup: {
      viewport: [1, 1],
      get allPages(): never {
        throw STOP
      },
    },
    context: {},
    run: { diagnostic: 'beauty' },
    gpu: {},
    // No light: the blends' first program is the one with every light code path.
    lights: { store: { count: 0, unlit: false } },
  } as unknown as WebgpuPagesRuntime
  await assert.rejects(prepareWebgpuVisibility(rt, device), STOP)
  return { failures, water: rt.blendState.water }
}

// The fallback stays only for a device whose limit is below the water pass's need.
test('a device below the water pass refuses it by name; one at its need builds it', async () => {
  const below = await waterFailures(deviceGranted(32))
  assert.deepEqual(below.failures, ['water-pass-refused'])
  assert.equal(below.water, undefined, 'the transmission slice falls back to a blend')
  const granted = await waterFailures(deviceGranted(128))
  assert.deepEqual(granted.failures, [])
  assert.ok(granted.water, 'the water pass is built')
})
