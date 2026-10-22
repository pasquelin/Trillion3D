import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import {
  inverseAtRenderOrigin,
  matrixAtRenderOrigin,
} from '../../../../../math/src/projection/renderOrigin.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { quantizationError } from '../../../post/taa/colorSpaceWgsl.ts'
import { stochasticSlot, type TaaFrameState } from '../../../post/taa/frameState.ts'
import { LIGHT_SHAFT_SAMPLER, type LightShaftSizes } from './describe.ts'
import { LIGHT_SHAFT_FORMAT, lightShaftFactor } from './layout.ts'
import {
  LIGHT_SHAFT_TEMPORAL_BINDING,
  LIGHT_SHAFT_TEMPORAL_ENTRY,
  LIGHT_SHAFT_TEMPORAL_VIEW,
  lightShaftTemporalProgram,
} from './temporalWgsl.ts'
import type { LightShaftHistory } from './temporalHistory.ts'

/**
 * The temporal filter's settings that the reference leaves to the view's anti-aliasing: the size of
 * the kernel the filter's weights are made of (1: smoother; 0: sharper but aliased), and whether the
 * kernel is a Catmull-Rom one, sharper than the Gaussian.
 */
export interface LightShaftTemporalKernel {
  readonly size: number
  readonly catmullRom: boolean
}

export const LIGHT_SHAFT_TEMPORAL_KERNEL: LightShaftTemporalKernel = { size: 1, catmullRom: false }

/** The offsets of the 3x3 around a pixel, the plus's five among them (`PLUS`), x to the right, y down. */
const OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const
const PLUS = [1, 3, 4, 5, 7] as const

/** The Catmull-Rom kernel at distance `x`. */
function catmullRom(x: number) {
  const ax = Math.abs(x)
  return ax > 1 ? ((-0.5 * ax + 2.5) * ax - 4) * ax + 2 : (1.5 * ax - 2.5) * ax * ax + 1
}

/**
 * The weights of the plus's five pixels (top, left, centre, right, bottom) for an image jittered by
 * `jitter` (`TaaFrameState.jitter`, in the pixels the scene is drawn in, y up in clip space) and
 * reduced by `divisor`: each pixel of the 3x3 weighs its kernel at its distance from the jittered
 * sample, in shafts' pixels over the kernel's size — `exp(-2.29 · d²)` or the Catmull-Rom product
 * per axis —, the nine summing to one, then the five of the plus summing to one.
 */
export function lightShaftTemporalWeights(
  jitter: ArrayLike<number>,
  divisor: number,
  kernel: LightShaftTemporalKernel = LIGHT_SHAFT_TEMPORAL_KERNEL,
) {
  // The clip-space jitter moves the image up by `jitter[1]`, a pixel row down by its opposite.
  const jx = jitter[0] / divisor,
    jy = -jitter[1] / divisor
  const nine = OFFSETS.map(([ox, oy]) => {
    const x = (ox - jx) / kernel.size,
      y = (oy - jy) / kernel.size
    return kernel.catmullRom ? catmullRom(x) * catmullRom(y) : Math.exp(-2.29 * (x * x + y * y))
  })
  const total = nine.reduce((sum, weight) => sum + weight, 0)
  const plus = PLUS.map((index) => nine[index] / total)
  const plusTotal = plus.reduce((sum, weight) => sum + weight, 0)
  return plus.map((weight) => weight / plusTotal)
}

/** What a draw of the temporal filter is: a full-screen triangle over the shafts' image view, its
 *  one group and entries, its target (the shafts' format, into the history's `next`), the uniform
 *  and the sampler the history is read through. */
export function describeLightShaftTemporal(sizes: LightShaftSizes) {
  const stage = GPUShaderStage.FRAGMENT,
    b = LIGHT_SHAFT_TEMPORAL_BINDING
  const target: GPUColorTargetState = { format: LIGHT_SHAFT_FORMAT }
  return {
    code: lightShaftTemporalProgram,
    vertexEntry: LIGHT_SHAFT_TEMPORAL_ENTRY.vertex,
    fragmentEntry: LIGHT_SHAFT_TEMPORAL_ENTRY.temporal,
    entries: [
      computeUniformEntry(b.view, {}, stage),
      computeTextureEntry(b.source, 'float', '2d', stage),
      computeTextureEntry(b.history, 'float', '2d', stage),
      computeSamplerEntry(b.sampler, 'filtering', stage),
      computeTextureEntry(b.depth, 'depth', '2d', stage),
    ],
    target,
    /** The pixels the pass draws, and the image it reads: the shafts'. */
    written: sizes.shaft.view,
    input: sizes.shaft,
    uniformFloats: LIGHT_SHAFT_TEMPORAL_VIEW.words,
    sampler: LIGHT_SHAFT_SAMPLER,
  }
}

/** What the uniform is written from. */
export interface LightShaftTemporalInput {
  readonly sizes: LightShaftSizes
  /** The sky quality's reduction of the shafts' image (`lightShaftDownsample`). */
  readonly downsample: number
  /** The view's temporal state: this image's jitter, the last image's view-projection, its
   *  exposure, and whether it exists. */
  readonly state: TaaFrameState
  /** The camera of this image, without jitter. */
  readonly camera: Pick<EngineCamera, 'viewProjection' | 'eye'>
  /** The history of the chain, as the last image left it. */
  readonly history: Pick<LightShaftHistory, 'valid' | 'viewport' | 'buffer'>
  /** This image's exposure (`taaExposure`). */
  readonly exposure: number
  /** The factor that takes the shafts' stored colour to the colour the tone mapping sees. */
  readonly frameExposure: number
  readonly kernel?: LightShaftTemporalKernel
}

const T = LIGHT_SHAFT_TEMPORAL_VIEW.at,
  previous = new Float64Array(16),
  anchored = new Float64Array(16),
  inverse = new Float64Array(16),
  product = new Float64Array(16)

/** The uniform (`LIGHT_SHAFT_TEMPORAL_VIEW`) into `out`, `LIGHT_SHAFT_TEMPORAL_VIEW.words` floats. */
export function writeLightShaftTemporalView(out: Float32Array, input: LightShaftTemporalInput) {
  const { sizes, state, camera, history } = input
  const divisor = lightShaftFactor(input.downsample)
  const { shaft, scene } = sizes
  const cut = !history.valid || !state.hasHistory
  // The last image's clip space, reached from this image's: both anchored at this image's eye,
  // the product made before the single-precision write.
  matrixAtRenderOrigin(previous, state.previousViewProjection, camera.eye)
  inverseAtRenderOrigin(inverse, anchored, camera.viewProjection, camera.eye)
  out.set(multiplyMatrix4(product, previous, inverse), T.clipToPrevClip)
  const { width: pw, height: ph } = shaft.view
  out.set([pw, ph, 1 / pw, 1 / ph], T.outputSize)
  out.set(
    [
      (pw - 0.5 * divisor) / pw,
      (ph - 0.5 * divisor) / ph,
      divisor / scene.view.width,
      divisor / scene.view.height,
    ],
    T.viewportUv,
  )
  out.set(
    [
      scene.view.width / divisor / shaft.texture.width,
      scene.view.height / divisor / shaft.texture.height,
      0,
      0,
    ],
    T.inputUv,
  )
  out.set([0, 0, pw - 1, ph - 1], T.inputRect)
  const { viewport, buffer } = history
  // The history's screen position to its texture coordinates, over the buffer it was drawn in.
  out.set(
    cut
      ? [1, 1, 1, 1]
      : [
          (viewport.width * 0.5) / buffer.width,
          (-viewport.height * 0.5) / buffer.height,
          (viewport.width * 0.5) / buffer.width,
          (viewport.height * 0.5) / buffer.height,
        ],
    T.history,
  )
  const [top, left, centre, right, bottom] = lightShaftTemporalWeights(
    state.jitter,
    divisor,
    input.kernel,
  )
  out.set([top, left, centre, right], T.plusA)
  out.set([bottom, 0, 0, 0], T.plusB)
  out.set(
    cut
      ? [0, 0]
      : [1 - 1 / ceilDiv(viewport.width, divisor), 1 - 1 / ceilDiv(viewport.height, divisor)],
    T.historyMax,
  )
  out.set(
    [input.frameExposure, state.hasHistory ? input.exposure / state.previousExposure : 1],
    T.exposure,
  )
  out[T.cut] = cut ? 1 : 0
  out[T.slot] = stochasticSlot(state)
  out[T.quantization] = quantizationError(LIGHT_SHAFT_FORMAT)
  return out
}
