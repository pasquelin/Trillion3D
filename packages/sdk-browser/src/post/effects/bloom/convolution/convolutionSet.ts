import type { Bloom } from '../../../../../../sdk-core/src/world/effect/bloom.ts'
import type { BloomValues } from '../../../../../../sdk-core/src/contracts/bloomRules.ts'
import { createWebgpuBindIdentity } from '../../../../gpu/bind/bindIdentity.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { namedGroup } from '../../../../gpu/core/computeBindings.ts'
import { dispatchOn } from '../../../../gpu/core/computeStages.ts'
import { chainReady } from '../../../../lighting/deferred/fullscreen.ts'
import { sameValues } from '../../../../../../math/src/matrix/matrixElements.ts'
import { uniformBlock, type UniformBlock } from '../../../../gpu/core/uniformBlock.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { fullscreenDraw } from '../../../filters/fullscreenDraw.ts'
import { EXPOSURE_BYTE, type PostFrame } from '../../../finish/finish.ts'
import { FFT_BINDINGS, FFT_BYTES, FFT_PARAMS } from './fftWgsl.ts'
import { CONVOLUTION_INPUT, CONVOLUTION_INPUT_BYTES, INPUT_BINDINGS } from './inputWgsl.ts'
import {
  convolutionLimits,
  convolutionPrograms,
  transformLineOf,
  type ConvolutionTransform,
} from './convolutionPrograms.ts'
import { createConvolutionKernel } from './convolutionKernel.ts'
import type { ConvolutionTargets } from './convolutionTargets.ts'
import { applyConstants, type ApplyConstants, type KernelStats, type Vec4 } from './kernelStats.ts'
import { planConvolution, type ConvolutionPlan } from './plan.ts'
import { writeTransformWords } from './transformShape.ts'

const PASS: GPUComputePassDescriptor = { label: BLOOM_PASS }

/** What a convolution leaves for the composition: the glow, what the image keeps of its own light —
 *  its colour times this, the rest having moved to the glow — and the passes encoded. */
interface ConvolutionGlow {
  glow: GPUTextureView
  sceneTint: Vec4
  passes: number
}

type Programs = ReturnType<typeof convolutionPrograms>

/** The shares the kernel asks (`applyConstants`), made again only when the kernel's reading or the
 *  strength moves. */
function createConstants() {
  let held: { stats: KernelStats; scatter: number; made: ApplyConstants } | undefined
  return (stats: KernelStats, scatter: number) => {
    if (held?.stats !== stats || held.scatter !== scatter)
      held = { stats, scatter, made: applyConstants(stats, scatter) }
    return held.made
  }
}

/** The plan of the transform for what it is made from — the image's size, the resolution, the kernel's
 *  size and the padding —, kept while they hold. */
function createPlanner(device: GPUDevice, programs: Programs) {
  const asked = [0, 0, NaN, NaN, NaN]
  let plan: ConvolutionPlan | undefined
  return (
    view: readonly number[],
    percent: number,
    { size, bufferScale }: Bloom['convolution'],
  ) => {
    const now = [view[0], view[1], percent, size, bufferScale]
    if (plan && sameValues(asked, now)) return plan
    asked.splice(0, 5, ...now)
    const limits = convolutionLimits(device, programs)
    return (plan = planConvolution({ view, percent, size, bufferScale }, limits))
  }
}

/** The image the plan reads: the level of the scene's chain it names, `image` where it names none. */
function levelOf(post: PostFrame, plan: ConvolutionPlan, image: GPUTextureView) {
  if (plan.level < 0) return image
  post.scene.need(plan.level + 1)
  return post.scene.view(plan.level)!
}

/**
 * THE IMAGE THE TRANSFORM READS WHERE THE LEVEL IS NOT IT: drawn from the level of the scene's chain
 * the plan reads (or the image itself) at the plan's size, with the local exposure the finishing
 * applies where the settings ask for it (`./inputWgsl.ts`). A level that is the plan's size and
 * needs no local exposure is read as it is — no pass, no image —: the transform's first pass holds
 * it to light that is a number and boosts what is bright as it loads (`./fftWgsl.ts`). A uniform and
 * a bind group are kept while their images and settings hold.
 */
function createInputPass(device: GPUDevice, programs: Programs, targets: ConvolutionTargets) {
  const uniform = uniformBlock(device, BLOOM_PASS, CONVOLUTION_INPUT_BYTES)
  const draw = fullscreenDraw(BLOOM_PASS)
  const identity = createWebgpuBindIdentity(2),
    groups: GPUBindGroup[] = []
  return {
    /** The image the transform reads for the plan over `source`: `source` itself, or the image drawn. */
    view(
      encoder: GPUCommandEncoder,
      plan: ConvolutionPlan,
      post: PostFrame,
      settings: BloomValues,
      source: GPUTextureView,
    ) {
      const layers = post.local && settings.bloomApplyLocalExposure
      if (!layers && plan.image[0] === plan.input[0] && plan.image[1] === plan.input[1]) {
        targets.dropInput()
        return source
      }
      const { f } = uniform.words
      const at = CONVOLUTION_INPUT.at
      f[at.outTexel] = 1 / plan.image[0]
      f[at.outTexel + 1] = 1 / plan.image[1]
      f[at.layers] = layers ? 1 : 0
      uniform.send()
      identity.next[0] = source
      identity.next[1] = uniform.buffer
      if (identity.moved())
        groups[identity.slot] = namedGroup(device, programs.layouts.input, INPUT_BINDINGS, {
          image: source,
          reader: programs.clamped,
          params: { buffer: uniform.buffer, size: CONVOLUTION_INPUT_BYTES },
        })
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

/** The three bind groups of the transform over `image`, the planes of its spectrum, the kernel's
 *  and the glow it writes, `uniform` its uniform. */
function transformGroups(
  device: GPUDevice,
  programs: Programs,
  uniform: GPUBuffer,
  views: {
    image: GPUTextureView
    planes: GPUBuffer
    kernel: GPUBuffer
    glow: GPUTextureView
    twiddles: GPUBuffer
  },
) {
  const params = { buffer: uniform, size: FFT_BYTES },
    factors = { buffer: views.twiddles },
    planes = { buffer: views.planes }
  const { forward, columns, inverse } = programs.layouts
  const group = (layout: GPUBindGroupLayout, resources: Parameters<typeof namedGroup>[3]) =>
    namedGroup(device, layout, FFT_BINDINGS, resources)
  return [
    group(forward, { params, source: views.image, planes, factors }),
    group(columns, { params, planes, factors, kernel: { buffer: views.kernel } }),
    group(inverse, { params, planes, factors, glow: views.glow }),
  ]
}

/** Writes the pre-filter of `boost` into the transform's uniform and sends it; whether it lifts. */
function sendPreFilter(uniform: UniformBlock, boost: Bloom['convolution']) {
  const { u, f } = uniform.words,
    at = FFT_PARAMS.at
  const lifts = boost.preFilterMin < boost.preFilterMax
  u[at.mode + 1] = lifts ? 1 : 0
  f[at.lift] = boost.preFilterMin
  f[at.lift + 1] = boost.preFilterMax
  f[at.lift + 2] = boost.preFilterMult
  uniform.send()
  return lifts
}

/**
 * THE TRANSFORM OF AN IMAGE: its rows, loaded with the bright pixels boosted — the boost
 * `preFilterMin`, `preFilterMax` and `preFilterMult` of the convolution, read at the exposure the
 * finishing copies in —, its columns — multiplied by the kernel's transform, divided by its sum and
 * transformed back — and its rows transformed back into the glow (`./fftWgsl.ts`). The uniform and
 * the three bind groups are kept while the images, the buffers and the settings hold.
 */
function createTransformPass(device: GPUDevice, programs: Programs, targets: ConvolutionTargets) {
  const uniform = uniformBlock(device, BLOOM_PASS, FFT_BYTES)
  const identity = createWebgpuBindIdentity(1)
  let groups: GPUBindGroup[] = []
  let written: { shape: object; scale: Vec4 } | undefined
  return {
    run(
      encoder: GPUCommandEncoder,
      plan: ConvolutionPlan,
      { stages: transform, twiddles }: ConvolutionTransform,
      image: GPUTextureView,
      kernel: GPUBuffer,
      scale: Vec4,
      boost: Bloom['convolution'],
      post: PostFrame,
    ) {
      const shape = plan.shapes.image
      if (written?.shape !== shape || written.scale !== scale) {
        writeTransformWords(uniform.words, shape, scale)
        written = { shape, scale }
      }
      // The luminance is read at the exposure the image is shown at, which only the GPU knows.
      if (sendPreFilter(uniform, boost))
        encoder.copyBufferToBuffer(
          post.uniform,
          EXPOSURE_BYTE,
          uniform.buffer,
          (FFT_PARAMS.at.lift + 3) * 4,
          4,
        )
      const planes = targets.spectrum(plan.bytes.image)
      const glow = targets.glowImage(plan.image[0], plan.image[1])
      identity.next[0] = image
      identity.next[1] = planes
      identity.next[2] = kernel
      identity.next[3] = glow
      identity.next[4] = uniform.buffer
      identity.next[5] = twiddles
      if (identity.moved())
        groups = transformGroups(device, programs, uniform.buffer, {
          image,
          planes,
          kernel,
          glow,
          twiddles,
        })
      const pass = encoder.beginComputePass(PASS)
      dispatchOn(pass, transform.forwardRows, groups[0], shape.lines)
      dispatchOn(pass, transform.convolveColumns, groups[1], shape.columns)
      dispatchOn(pass, transform.inverseRows, groups[2], shape.lines)
      pass.end()
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
      const plan = planFor(post.scene.imageSize, settings.bloomScreenPercentage, conv)
      // The transform's programs for this plan's line: asked at the first sight of a size, the frames held
      // on them and the kind's `arriving` told. The kernel's, the input's and the transform's run
      // whole or not at all, nothing drawn meanwhile: a kernel made by a missing program would be kept.
      const line = programs.transforms.of(transformLineOf(plan))
      const chain = [
        ...Object.values(programs.kernel),
        programs.input,
        ...Object.values(line.stages),
      ]
      if (!chainReady(...chain)) return undefined
      // The method requires the kernel (`resolveBloom`).
      const spectrum = kernel.ensure(encoder, plan, conv.kernel!, settings.bloomCacheKernel)
      if (!spectrum.buffer) return undefined
      const source = levelOf(post, plan, image)
      const scatter = conv.scatterDispersion * bloom.intensity * conv.intensity
      const { sceneTint, multiply } = constants(spectrum.stats, scatter)
      const read = input.view(encoder, plan, post, settings, source)
      result.glow = transform.run(encoder, plan, line, read, spectrum.buffer, multiply, conv, post)
      result.sceneTint = sceneTint
      result.passes = spectrum.passes + (read === source ? 1 : 2)
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
