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
import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { put4 } from '../clouds/reconstructLayout.ts'
import { LIGHT_SHAFT_SAMPLER } from './describe.ts'
import { LIGHT_SHAFT_FORMAT, type LightShaftSizes } from './layout.ts'
import {
  LIGHT_SHAFT_TEMPORAL_BINDING,
  LIGHT_SHAFT_TEMPORAL_ENTRY,
  LIGHT_SHAFT_TEMPORAL_VIEW,
  lightShaftTemporalProgram,
} from './temporalWgsl.ts'
import type { LightShaftHistory } from './temporalHistory.ts'

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

/** The inputs of the weights last made, and the weights: the filter asks for them with every
 *  light's chain of the image, with the same jitter. */
let weightsFor = { jx: NaN, jy: NaN, divisor: NaN, size: NaN, catmullRom: false }
let weights: readonly number[] = []

/**
 * The weights of the plus's five pixels (top, left, centre, right, bottom) for an image jittered by
 * `jitter` (`TaaFrameState.jitter`, in the pixels the scene is drawn in, y up in clip space) and
 * reduced by `divisor`: each pixel of the 3x3 weighs its kernel at its distance from the jittered
 * sample, in shafts' pixels over the kernel's `size` — `exp(-2.29 · d²)` or, with `catmullRom`, the
 * Catmull-Rom product per axis —, the nine summing to one, then the five of the plus summing to
 * one. The last answer is kept while the inputs are the same.
 */
function lightShaftTemporalWeights(
  jitter: ArrayLike<number>,
  divisor: number,
  size: number,
  catmullRomKernel: boolean,
) {
  // The clip-space jitter moves the image up by `jitter[1]`, a pixel row down by its opposite.
  const jx = jitter[0] / divisor,
    jy = -jitter[1] / divisor
  const last = weightsFor
  if (
    last.jx === jx &&
    last.jy === jy &&
    last.divisor === divisor &&
    last.size === size &&
    last.catmullRom === catmullRomKernel
  )
    return weights
  const nine = OFFSETS.map(([ox, oy]) => {
    const x = (ox - jx) / size,
      y = (oy - jy) / size
    return catmullRomKernel ? catmullRom(x) * catmullRom(y) : Math.exp(-2.29 * (x * x + y * y))
  })
  const total = nine.reduce((sum, weight) => sum + weight, 0)
  const plus = PLUS.map((index) => nine[index] / total)
  const plusTotal = plus.reduce((sum, weight) => sum + weight, 0)
  weightsFor = { jx, jy, divisor, size, catmullRom: catmullRomKernel }
  return (weights = plus.map((weight) => weight / plusTotal))
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
  /** The sky quality's size of the kernel the weights are made of and whether it is Catmull-Rom. */
  readonly quality: Pick<
    SkyQualityValues,
    'lightShaftTemporalFilterSize' | 'lightShaftTemporalCatmullRom'
  >
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
}

const T = LIGHT_SHAFT_TEMPORAL_VIEW.at
// Scratch the matrices are made in, reused: nothing is allocated per call.
const previous = new Float64Array(16),
  anchored = new Float64Array(16),
  inverse = new Float64Array(16),
  product = new Float64Array(16)
/** The inputs `product` was made from (the last image's view-projection, this image's, the eye),
 *  whether it holds one: every chain of an image has the same, so the product and the inverse are
 *  made once. */
const made = new Float64Array(35)
let madeOnce = false

const holds = (at: number, values: ArrayLike<number>, count: number) => {
  for (let i = 0; i < count; i++) if (made[at + i] !== values[i]) return false
  return true
}

/** The last image's clip space, reached from this image's: both anchored at this image's eye, the
 *  product made before the single-precision write. */
function clipToPrevClip(
  previousViewProjection: ArrayLike<number>,
  { viewProjection, eye }: Pick<EngineCamera, 'viewProjection' | 'eye'>,
) {
  if (
    madeOnce &&
    holds(0, previousViewProjection, 16) &&
    holds(16, viewProjection, 16) &&
    holds(32, eye, 3)
  )
    return product
  matrixAtRenderOrigin(previous, previousViewProjection, eye)
  inverseAtRenderOrigin(inverse, anchored, viewProjection, eye)
  multiplyMatrix4(product, previous, inverse)
  for (let i = 0; i < 16; i++) {
    made[i] = previousViewProjection[i]
    made[16 + i] = viewProjection[i]
  }
  for (let i = 0; i < 3; i++) made[32 + i] = eye[i]
  madeOnce = true
  return product
}

/** The uniform (`LIGHT_SHAFT_TEMPORAL_VIEW`) into `out`, `LIGHT_SHAFT_TEMPORAL_VIEW.words` floats. */
export function writeLightShaftTemporalView(out: Float32Array, input: LightShaftTemporalInput) {
  const { sizes, state, camera, history, quality } = input
  const { shaft, scene, factor } = sizes
  const cut = !history.valid || !state.hasHistory
  out.set(clipToPrevClip(state.previousViewProjection, camera), T.clipToPrevClip)
  const { width: pw, height: ph } = shaft.view
  put4(out, T.outputSize, pw, ph, 1 / pw, 1 / ph)
  put4(
    out,
    T.viewportUv,
    (pw - 0.5 * factor) / pw,
    (ph - 0.5 * factor) / ph,
    factor / scene.view.width,
    factor / scene.view.height,
  )
  put4(
    out,
    T.inputUv,
    scene.view.width / factor / shaft.texture.width,
    scene.view.height / factor / shaft.texture.height,
    0,
    0,
  )
  put4(out, T.inputRect, 0, 0, pw - 1, ph - 1)
  const { viewport, buffer } = history
  // The history's screen position to its texture coordinates, over the buffer it was drawn in.
  const halfX = (viewport.width * 0.5) / buffer.width,
    halfY = (viewport.height * 0.5) / buffer.height
  if (cut) put4(out, T.history, 1, 1, 1, 1)
  else put4(out, T.history, halfX, (-viewport.height * 0.5) / buffer.height, halfX, halfY)
  const [top, left, centre, right, bottom] = lightShaftTemporalWeights(
    state.jitter,
    factor,
    quality.lightShaftTemporalFilterSize,
    quality.lightShaftTemporalCatmullRom,
  )
  put4(out, T.plusA, top, left, centre, right)
  put4(out, T.plusB, bottom, 0, 0, 0)
  out[T.historyMax] = cut ? 0 : 1 - 1 / ceilDiv(viewport.width, factor)
  out[T.historyMax + 1] = cut ? 0 : 1 - 1 / ceilDiv(viewport.height, factor)
  out[T.exposure] = input.frameExposure
  out[T.exposure + 1] = state.hasHistory ? input.exposure / state.previousExposure : 1
  out[T.cut] = cut ? 1 : 0
  out[T.slot] = stochasticSlot(state)
  out[T.quantization] = quantizationError(LIGHT_SHAFT_FORMAT)
  return out
}
