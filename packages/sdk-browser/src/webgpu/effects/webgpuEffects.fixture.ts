// What the effect-chain tests share: the kit device's encoder and its passes, and a chain on it.
import assert from 'node:assert/strict'
import { fakeDevice, written, type FakeWrite } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { commandArgs, type MockPass } from '../../../../../tests/kit/gpu/mockRenderPass.ts'
import { createWebgpuEffects } from './webgpuEffects.ts'

/** A write's words as the floats the bloom's slots hold. */
export const floatsOf = (write: FakeWrite) => {
  const data = written(write)
  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
}

/** The first target of `pass`: its view and its load. */
export const viewOf = (pass: MockPass) => pass.colors[0]?.view
export const loadOf = (pass: MockPass) => pass.colors[0]?.loadOp
/** The dynamic offset `pass` set its first bind group at. */
export const offsetOf = (pass: MockPass) =>
  (
    commandArgs(pass.commands, 'setBindGroup').find(([index]) => !index)?.[2] as
      Uint32Array | undefined
  )?.[0]

/** One of `gpu`'s encoders, its render passes, and every descriptor and first group's offset array
 *  the chain handed it. */
export function recorder(gpu: ReturnType<typeof fakeDevice>) {
  const handed = () =>
    new Set<unknown>([
      ...gpu.passDescriptors,
      ...gpu.passes.flatMap(({ commands }) =>
        commandArgs(commands, 'setBindGroup')
          .filter(([index]) => !index)
          .map(([, , offsets]) => offsets),
      ),
    ])
  return { encoder: gpu.device.createCommandEncoder(), passes: gpu.passes, handed }
}

export const input = { input: true } as unknown as GPUTextureView

/** The chain on a device aligning uniform offsets at `alignment` bytes. */
export async function loaded(alignment = 256) {
  const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: alignment } })
  const effects = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)))
  return { gpu, effects }
}
