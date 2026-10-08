// What the effect-chain tests share: the encoder that records passes, and a chain on a fake device.
import assert from 'node:assert/strict'
import { fakeDevice, written, type FakeWrite } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createWebgpuEffects } from './webgpuEffects.ts'

/** A write's words as the floats the bloom's slots hold. */
export const floatsOf = (write: FakeWrite) => {
  const data = written(write)
  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
}

/** An encoder that records the passes begun on it, their target and the dynamic offset of
 *  their first bind group, as each begins, and every descriptor and offset array it was handed. */
export function recorder() {
  const passes: { label?: string; load: string; view: unknown; offset?: number }[] = []
  const handed = new Set<unknown>()
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
      const [color] = descriptor.colorAttachments as GPURenderPassColorAttachment[]
      const pass = { label: descriptor.label, load: color.loadOp, view: color.view } as const
      passes.push(pass)
      handed.add(descriptor)
      const setBindGroup = (index: number, _group: unknown, offsets?: Uint32Array) => {
        if (index) return
        handed.add(offsets)
        Object.assign(pass, { offset: offsets?.[0] })
      }
      return { setPipeline() {}, setBindGroup, draw() {}, end() {} }
    },
  } as unknown as GPUCommandEncoder
  return { encoder, passes, handed }
}

export const input = { input: true } as unknown as GPUTextureView

/** The chain on a device aligning uniform offsets at `alignment` bytes. */
export async function loaded(alignment = 256) {
  const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: alignment } })
  const effects = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)))
  return { gpu, effects }
}
