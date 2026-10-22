// What the effect-chain tests share: the kit device's encoder and its passes, and a chain on it.
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written, type FakeWrite } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { commandArgs, type FakePass } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { createWebgpuEffects } from './webgpuEffects.ts'
import { createFinish, type PostFrame } from '../finish/finish.ts'
import { resolveBloom } from '../../../../sdk-core/src/contracts/bloomOptions.ts'

/** The bloom with every field at its default. */
export const DEFAULT_BLOOM = resolveBloom()

/** A write's words as the floats the uniform it wrote holds. */
export const floatsOf = (write: FakeWrite) => {
  const data = written(write)
  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
}

/** The first target of `pass`: its view and its load. */
export const viewOf = (pass: FakePass) => pass.colors[0]?.view

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

/** The chain on a kit device: its display finishing beside it, which a frame begins on the image
 *  (`frame`) before the chain draws — what the renderer shares between the local exposure and the
 *  bloom (`../finish/finish.ts`), the local exposure `local` where a test wants its setup. */
export async function loaded() {
  const gpu = fakeDevice()
  const effects = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)))
  const finish = createFinish(gpu.device)
  const frame = (
    encoder: GPUCommandEncoder,
    width: number,
    height: number,
    local = false,
  ): PostFrame => {
    finish.scene.begin(encoder, input, width, height)
    return { scene: finish.scene, bare: finish.bare, layers: finish.groupFor(local), local }
  }
  return { gpu, effects, finish, frame }
}
