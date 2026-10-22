// What the effect-chain tests share: the kit device's encoder and its passes, and a chain on it.
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { written, type FakeWrite } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { commandArgs, type FakePass } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { createWebgpuEffects } from './webgpuEffects.ts'
import { createFinish, type PostFrame } from '../finish/finish.ts'
import { resolveBloom } from '../../../../sdk-core/src/contracts/bloomOptions.ts'
import {
  MOTION_BLUR_RULES,
  type MotionBlurSettings,
} from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { TAA_VIEW_BYTES } from '../taa/bindingsWgsl.ts'
import type { ResolveFrame } from './webgpuKinds.ts'

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

/** The projection the resolved stage's camera has: a 40-degree vertical field on a 16:9 image. */
const LENS = Float64Array.from({ length: 16 }, (_, at) =>
  at === 5 ? 2.7474774 : at === 0 ? 1.5453 : 0,
)

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

/** The frame the resolved stage reads on a kit device, at the image's size (`extent` the size of
 *  the images it lies in, its own by default), the blur drawn as `settings` say. */
export function frameOf(
  gpu: Awaited<ReturnType<typeof loaded>>['gpu'],
  width: number,
  height: number,
  settings: MotionBlurSettings = {},
  extent = [width, height],
): ResolveFrame {
  const view = (format: GPUTextureFormat, usage: number) =>
    gpu.device.createTexture({ size: { width, height }, format, usage }).createView()
  return {
    size: [width, height],
    extent,
    render: [width, height],
    allocated: extent,
    vectors: view('r32uint', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING),
    depth: view('depth32float', GPUTextureUsage.TEXTURE_BINDING),
    view: gpu.device.createBuffer({ size: TAA_VIEW_BYTES, usage: GPUBufferUsage.UNIFORM }),
    settings: resolveSettings(MOTION_BLUR_RULES, settings),
    depthOfField: resolveSettings(DEPTH_OF_FIELD_RULES, {}),
    camera: { projection: LENS, perspective: true, near: 0.1, exposure: 1 },
    now: 0,
    still: false,
  }
}

/** The words a uniform buffer holds, as the writes left them. */
export const wordsOf = (buffer: GPUBuffer) => {
  const { data } = buffer as unknown as { data: Uint8Array }
  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
}
/** The filter's four dispatches, one a class, and the passes before them. */
export const FILTERS = Array<string>(4).fill('filterTiles')
export const HEAD = ['flattenMotion', 'dilateGather', 'classifyTiles']

/** A chain of motion blurs on a kit device, their programs compiled, drawn as `settings` say. */
export async function blurring(
  settings: MotionBlurSettings,
  ...passes: Parameters<typeof effect.motionBlur>[]
) {
  const made = await loaded()
  const chain = passes.map((options) => effect.motionBlur(options))
  made.effects.readyResolved(chain)
  await made.effects.settled()
  const { encoder } = recorder(made.gpu)
  return { ...made, chain, encoder, frame: frameOf(made.gpu, 64, 32, settings) }
}
