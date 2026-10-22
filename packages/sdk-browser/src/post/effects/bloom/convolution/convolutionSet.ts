import type { Bloom } from '../../../../../../sdk-core/src/world/effect/bloom.ts'
import type { BloomValues } from '../../../../../../sdk-core/src/contracts/bloomRules.ts'
import type { BloomKernelImage } from '../../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'
import { createWebgpuBindIdentity } from '../../../../gpu/bind/bindIdentity.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { writeChanged } from '../../../../gpu/core/writeChanged.ts'
import { textureLimits } from '../../../../gpu/core/textureLimits.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { fullscreenDraw } from '../../../filters/fullscreenDraw.ts'
import type { PostFrame } from '../../../finish/finish.ts'
import { FFT_BYTES } from './fftWgsl.ts'
import { CONVOLUTION_INPUT, CONVOLUTION_INPUT_BYTES } from './inputWgsl.ts'
import { bindTo, convolutionPrograms, dispatchStage } from './convolutionPrograms.ts'
import { createConvolutionKernel } from './convolutionKernel.ts'
import type { ConvolutionTargets } from './convolutionTargets.ts'
import { defaultBloomKernel } from './defaultKernel.ts'
import { applyConstants, type KernelStats, type Vec4 } from './kernelStats.ts'
import { planConvolution, type ConvolutionAsk, type ConvolutionPlan } from './plan.ts'
import { channelScale, transformShape, writeTransformWords } from './transformShape.ts'

/** What a convolution leaves for the composition: the glow, what the image keeps of its own light —
 *  its colour times this, the rest having moved to the glow — and the passes encoded. */
export interface ConvolutionGlow {
  glow: GPUTextureView
  sceneTint: Vec4
  passes: number
}

/** WebGPU's guaranteed `maxStorageBufferBindingSize`: the bytes of a buffer every device binds. */
const GUARANTEED_STORAGE_BYTES = 134217728

/**
 * THE SHARES THE KERNEL ASKS (`applyConstants`) and the multiplier of each channel they make
 * (`channelScale`), made again only when the kernel's reading or the strength moves.
 */
function createConstants() {
  let held:
    { stats: KernelStats; scatter: number; made: { sceneTint: Vec4; scale: Vec4 } } | undefined
  return {
    of(stats: KernelStats, scatter: number) {
      if (held?.stats === stats && held.scatter === scatter) return held.made
      const { sceneTint, multiply } = applyConstants(stats, scatter)
      held = { stats, scatter, made: { sceneTint, scale: channelScale(multiply) } }
      return held.made
    },
  }
}

/** The kernel a page did not give, drawn once. */
let fallback: BloomKernelImage | undefined
const defaultKernel = () => (fallback ??= defaultBloomKernel())

type Programs = ReturnType<typeof convolutionPrograms>

/** A uniform buffer of `size` bytes, written from `words` by what changed of them. */
function uniformOf(device: GPUDevice, size: number) {
  const buffer = device.createBuffer({
    label: BLOOM_PASS,
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Float32Array(size / 4)
  const image = new Uint32Array(words.buffer)
  return { buffer, words, send: () => writeChanged(device, buffer, image, 0, image.length) }
}

/** The plan of the transform for an ask, kept while the ask holds. */
function createPlanner(device: GPUDevice, programs: Programs) {
  let planned: { ask: ConvolutionAsk; plan: ConvolutionPlan } | undefined
  return (ask: ConvolutionAsk) => {
    const last = planned?.ask
    if (
      last &&
      last.view[0] === ask.view[0] &&
      last.view[1] === ask.view[1] &&
      last.percent === ask.percent &&
      last.size === ask.size &&
      last.bufferScale === ask.bufferScale
    )
      return planned!.plan
    const limits = {
      side: textureLimits(device.limits).side,
      maxLine: programs.maxLine,
      bytes: device.limits?.maxStorageBufferBindingSize ?? GUARANTEED_STORAGE_BYTES,
    }
    const view = [ask.view[0], ask.view[1]]
    planned = { ask: { ...ask, view }, plan: planConvolution(ask, limits) }
    return planned.plan
  }
}

/**
 * THE IMAGE THE TRANSFORM READS: drawn from the level of the scene's chain the plan reads (or the
 * image itself) at the plan's size, with the local exposure the finishing applies where the settings
 * ask for it and the boost of its bright pixels (`./inputWgsl.ts`). A uniform and a bind group are
 * kept while their images and settings hold.
 */
function createInputPass(device: GPUDevice, programs: Programs, targets: ConvolutionTargets) {
  const uniform = uniformOf(device, CONVOLUTION_INPUT_BYTES)
  const draw = fullscreenDraw(BLOOM_PASS)
  const identity = createWebgpuBindIdentity(2),
    groups: GPUBindGroup[] = []
  return {
    draw(
      encoder: GPUCommandEncoder,
      plan: ConvolutionPlan,
      bloom: Bloom,
      post: PostFrame,
      settings: BloomValues,
      source: GPUTextureView,
    ) {
      const { preFilterMin: min, preFilterMax: max, preFilterMult: mult } = bloom.convolution
      const at = CONVOLUTION_INPUT.at
      const words = uniform.words
      words[at.outTexel] = 1 / plan.image[0]
      words[at.outTexel + 1] = 1 / plan.image[1]
      words[at.layers] = post.local && settings.bloomApplyLocalExposure ? 1 : 0
      words[at.lift] = min
      words[at.lift + 1] = max
      words[at.lift + 2] = mult
      words[at.lift + 3] = min < max ? 1 : 0
      uniform.send()
      identity.next[0] = source
      identity.next[1] = uniform.buffer
      if (identity.moved())
        groups[identity.slot] = bindTo(device, programs.layouts.input, [
          [0, source],
          [1, programs.clamped],
          [2, { buffer: uniform.buffer, size: CONVOLUTION_INPUT_BYTES }],
        ])
      const image = targets.inputImage(plan.image[0], plan.image[1])
      draw(encoder, image, programs.input.get(), groups[identity.slot], post.layers)
      return image
    },
    dispose() {
      retire(device, uniform.buffer)
      identity.clear()
      groups.length = 0
    },
  }
}

/**
 * THE TRANSFORM OF AN IMAGE: its rows, its columns — multiplied by the kernel's transform, divided by
 * its sum and transformed back — and its rows transformed back into the glow (`./fftWgsl.ts`). The
 * uniform and the three bind groups are kept while the images, the buffers and the settings hold.
 */
function createTransformPass(device: GPUDevice, programs: Programs, targets: ConvolutionTargets) {
  const uniform = uniformOf(device, FFT_BYTES)
  const identity = createWebgpuBindIdentity(1)
  let groups: GPUBindGroup[] = []
  let written: { shape: object; scale: Vec4 } | undefined
  return {
    run(
      encoder: GPUCommandEncoder,
      plan: ConvolutionPlan,
      image: GPUTextureView,
      kernel: GPUBuffer,
      scale: Vec4,
    ) {
      const shape = transformShape(plan, false)
      if (written?.shape !== shape || written.scale !== scale) {
        writeTransformWords(uniform.words, shape, scale)
        uniform.send()
        written = { shape, scale }
      }
      const planes = targets.spectrum(plan.bytes.image)
      const glow = targets.glowImage(plan.image[0], plan.image[1])
      identity.next[0] = image
      identity.next[1] = planes
      identity.next[2] = kernel
      identity.next[3] = glow
      identity.next[4] = uniform.buffer
      if (identity.moved()) {
        const binding = { buffer: uniform.buffer, size: FFT_BYTES },
          factors = { buffer: programs.twiddles },
          rw = { buffer: planes }
        const { forward, columns, inverse } = programs.layouts
        groups = [
          bindTo(device, forward, [
            [0, binding],
            [1, image],
            [2, rw],
            [3, factors],
          ]),
          bindTo(device, columns, [
            [0, binding],
            [2, rw],
            [3, factors],
            [4, { buffer: kernel }],
          ]),
          bindTo(device, inverse, [
            [0, binding],
            [2, rw],
            [3, factors],
            [5, glow],
          ]),
        ]
      }
      dispatchStage(encoder, programs.transform.forwardRows, groups[0], shape.lines)
      dispatchStage(encoder, programs.transform.convolveColumns, groups[1], shape.columns)
      dispatchStage(encoder, programs.transform.inverseRows, groups[2], shape.lines)
      return glow
    },
    dispose() {
      retire(device, uniform.buffer)
      identity.clear()
      groups = []
    },
  }
}

/**
 * ONE BLOOM'S CONVOLUTION, over the images its chain shares (`ConvolutionTargets`): the plan of the
 * transform for the image and the settings (`planConvolution`), the kernel's transform
 * (`createConvolutionKernel`), then, each image, the passes that read the image and write the glow
 * (`createInputPass`, `createTransformPass`). An image allocates nothing.
 */
export function createConvolution(device: GPUDevice, targets: ConvolutionTargets) {
  const programs = convolutionPrograms(device)
  const kernel = createConvolutionKernel(device)
  const input = createInputPass(device, programs, targets)
  const transform = createTransformPass(device, programs, targets)
  const planFor = createPlanner(device, programs)
  const constants = createConstants()
  // What `encode` returns, rewritten by each image: an image allocates none.
  const result = {} as ConvolutionGlow
  return {
    /**
     * Draws the convolution of the image `image` — the image `post` begins, `post.scene` its chain —
     * as `bloom` and `settings` ask, into the glow of `targets`; returns it with what the image
     * keeps of its light, none for a kernel that holds no light.
     */
    encode(
      encoder: GPUCommandEncoder,
      bloom: Bloom,
      post: PostFrame,
      settings: BloomValues,
      image: GPUTextureView,
    ): ConvolutionGlow | undefined {
      const conv = bloom.convolution
      const plan = planFor({
        view: post.scene.imageSize,
        percent: settings.bloomScreenPercentage,
        size: conv.size,
        bufferScale: conv.bufferScale,
      })
      const spectrum = kernel.ensure(
        encoder,
        plan,
        conv.kernel ?? defaultKernel(),
        settings.bloomCacheKernel,
      )
      if (!spectrum.buffer) return undefined
      let source = image
      if (plan.level >= 0) {
        post.scene.need(plan.level + 1)
        source = post.scene.view(plan.level)!
      }
      const scatter = conv.scatterDispersion * bloom.intensity * conv.intensity
      const { sceneTint, scale } = constants.of(spectrum.stats, scatter)
      const read = input.draw(encoder, plan, bloom, post, settings, source)
      result.glow = transform.run(encoder, plan, read, spectrum.buffer, scale)
      result.sceneTint = sceneTint
      result.passes = spectrum.passes + 4
      return result
    },
    /** Bytes of the kernel's transform and picture. */
    get bytes() {
      return kernel.bytes
    },
    dispose() {
      kernel.dispose()
      input.dispose()
      transform.dispose()
    },
  }
}
