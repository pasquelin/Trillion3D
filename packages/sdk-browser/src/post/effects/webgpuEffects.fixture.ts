// What the effect-chain tests share: the kit device's encoder and its passes, and a chain on it.
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs, type FakePass } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { FakeBuffer } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import type { EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { createKindSettings } from './kindSettings.ts'
import { createWebgpuEffects } from './webgpuEffects.ts'
import { createWebgpuMotionBlur } from './webgpuMotionBlur.ts'
import { MOTION_BLUR_PARAMS, MOTION_BLUR_PARAMS_BYTES } from './motionBlur/motionBlurLayout.ts'
import { createFinish, type PostFrame } from '../finish/finish.ts'
import { lensOf } from '../finish/finishParams.ts'
import { resolveBloom } from '../../../../sdk-core/src/contracts/bloomOptions.ts'
import type { MotionBlurSettings } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { DepthOfFieldSettings } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { effect, type MotionBlurOptions } from '../../../../sdk-core/src/world/effect/index.ts'
import { TAA_VIEW_BYTES } from '../taa/bindingsWgsl.ts'
import type { ResolveFrame } from './webgpuKinds.ts'

/** The passes of `passes` that draw, as the frame hands them to the stages: not idle, not turned off. */
export const drawn = (passes: readonly EffectPass[], context?: object) =>
  createKindSettings().drawn(passes, context, [])

/** The bloom with every field at its default. */
export const DEFAULT_BLOOM = resolveBloom()

/** The words a buffer holds now, as floats. */
export const floatsOf = ({ data }: { data: Uint8Array }) =>
  new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)

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
export async function loaded(options?: Parameters<typeof fakeDevice>[0]) {
  const gpu = fakeDevice(options)
  const effects = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)))
  const finish = createFinish(gpu.device)
  const frame = (
    encoder: GPUCommandEncoder,
    width: number,
    height: number,
    local = false,
  ): PostFrame => {
    finish.scene.begin(encoder, input, width, height)
    return {
      scene: finish.scene,
      bare: finish.bare,
      layers: finish.groupFor(local),
      local,
      uniform: finish.uniform,
      lens: lensOf(null),
    }
  }
  // The stages around the temporal pass, which the tests of the passes on them name.
  const [lit, after] = [effects.stage('before-resolve'), effects.stage('after-resolve')]
  return { gpu, effects, finish, frame, lit, after }
}

/** The frame the stages before and after the temporal pass read on a kit device, at the image's size
 *  (`extent` the size of the images it lies in, its own by default), the passes drawn as `settings`
 *  say: the session's settings, the defaults of the kinds where none is named. The temporal pass
 *  accumulates the image, with a history, where `temporal` says, to a display of `display`, the
 *  image's own size by default. */
export function frameOf(
  gpu: Awaited<ReturnType<typeof loaded>>['gpu'],
  width: number,
  height: number,
  settings: MotionBlurSettings & DepthOfFieldSettings = {},
  extent = [width, height],
  temporal = false,
  display = [width, height],
): ResolveFrame {
  const view = (format: GPUTextureFormat, usage: number) =>
    gpu.device.createTexture({ size: { width, height }, format, usage }).createView()
  return {
    size: [width, height],
    extent,
    display,
    render: [width, height],
    allocated: extent,
    vectors: view('r32uint', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING),
    depth: view('depth32float', GPUTextureUsage.TEXTURE_BINDING),
    view: gpu.device.createBuffer({ size: TAA_VIEW_BYTES, usage: GPUBufferUsage.UNIFORM }),
    session: settings,
    temporal: { active: temporal, cut: false, jitter: [0.25, -0.25], slot: 0 },
    camera: { projection: LENS, perspective: true, near: 0.1, exposure: 1 },
    now: 0,
    still: false,
    resolved: true,
    flatten: undefined,
  }
}

/** The words a uniform buffer holds, as the writes left them. */
export const wordsOf = (buffer: GPUBuffer | FakeBuffer) => {
  const { data } = buffer as unknown as { data: Uint8Array }
  return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
}
/** The same words, as the unsigned numbers a shader reads them. */
export const intsOf = (buffer: GPUBuffer | FakeBuffer) => {
  const words = wordsOf(buffer)
  return new Uint32Array(words.buffer, words.byteOffset, words.length)
}
/** The filter's four dispatches, one a class, and the passes before them. */
export const FILTERS = Array<string>(4).fill('filterTiles')
export const HEAD = ['flattenMotion', 'dilateGather', 'classifyTiles']

/** A chain of motion blurs on a kit device, their programs compiled, drawn as `settings` say. */
export async function blurring(settings: MotionBlurSettings, ...passes: MotionBlurOptions[]) {
  const made = await loaded()
  const chain = passes.map((options) => effect.motionBlur(options))
  made.after.ready(chain)
  await made.effects.settled()
  const { encoder } = recorder(made.gpu)
  return { ...made, chain, encoder, frame: frameOf(made.gpu, 64, 32, settings) }
}

/** The `k`th word of `field` of the blur's uniform, as its last write left it. */
export const uniformWord = (gpu: Awaited<ReturnType<typeof loaded>>['gpu'], field: string, k = 0) =>
  wordsOf(gpu.writes.find(({ buffer }) => buffer.size === MOTION_BLUR_PARAMS_BYTES)!.buffer)[
    MOTION_BLUR_PARAMS.at[field as 'scale'] + k
  ]

/** The formats of the `flat` textures a blur made, in order. */
export const flats = (gpu: Awaited<ReturnType<typeof loaded>>['gpu']) =>
  gpu.textures.filter(({ label }) => label?.endsWith('flat')).map(({ format }) => format)

/** One image of a blur drawn as `settings` say, its pass as `pass` says, the image the temporal pass
 *  `resolved` or not: its scale, its longest streak and whether its samples may read the half-size
 *  image, as the uniform holds them. */
export async function strengthOf(settings: object, pass = {}, resolved = true) {
  const { gpu, chain, encoder, frame, after } = await blurring(settings, pass)
  frame.resolved = resolved
  after.resolve(encoder, chain, input, frame)
  return [uniformWord(gpu, 'scale'), uniformWord(gpu, 'scale', 2), uniformWord(gpu, 'knobs', 2)]
}

/** The text of each filter pipeline a blur makes on a device that grants `features`. */
export async function filterCodes(features: GPUFeatureName[]) {
  const kit = fakeDevice({ features })
  await createWebgpuMotionBlur(kit.device)
  return kit.computePipelines
    .filter(({ compute }) => compute.entryPoint === 'filterTiles')
    .map(({ compute }) => (compute.module as unknown as { code: string }).code)
}
