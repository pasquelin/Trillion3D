import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import type { ResolvedDepthOfField } from '../../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import type { DepthOfFieldValues } from '../../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { TAA_VIEW } from '../../taa/bindingsWgsl.ts'
import { putDepthTerms } from '../../taa/view.ts'
import { METRES_PER_CENTIMETRE } from './cocModel.ts'
import { circleRatio, errorMultiplierOf, type DofPlan } from './dofPlan.ts'
import { COC_TILE, DOF_PARAMS, DOF_STEP, SCATTER_GROUP_MARGIN } from './dofLayout.ts'

/** The `x`th word of a field of the uniform. */
const AT = DOF_PARAMS.at
const STEP = DOF_STEP.at
/** The block the projection's depth terms are written into by the temporal passes' writer, laid out as their uniform. */
const scratch = new Float32Array(TAA_VIEW.words)

/** What the uniform is written from, refilled at each image. */
export interface DofParamsInput {
  readonly plan: DofPlan
  readonly settings: DepthOfFieldValues
  readonly volume: ResolvedDepthOfField
  /** The size of the depth (the render grid) and the size of the textures the image lies in. */
  readonly render: readonly number[]
  readonly extent: readonly number[]
  /** The camera's projection, column-major, and whether it is a perspective one. */
  readonly projection: ArrayLike<number>
  readonly perspective: boolean
  /** The exposure the image is shown at, which the scatter's brightness test reads. */
  readonly exposure: number
  /** The display's size, and the size the history of the setup's accumulation was written at. */
  readonly display: readonly number[]
  readonly historyDisplay: readonly number[]
  /** The frame's rank among eight, which the recombine's sample pattern turns by, the image's jitter in
   *  render pixels, as the temporal pass reads it, and whether the history of the setup's accumulation
   *  describes nothing. */
  readonly frame: number
  readonly jitter: readonly [number, number]
  readonly cut: boolean
}

/** The matte box's three flags as the sine and cosine of each flag's pitch and roll, and the
 *  reciprocal of the pitch's sine and its length, the pitch measured from the barrel's side. */
function writeMatteBox(into: Float32Array, volume: ResolvedDepthOfField) {
  let active = false
  const { matteBox } = volume
  for (let at = 0; at < matteBox.length; at++) {
    const pitch = (matteBox[at].pitch + 90) * DEG2RAD
    const roll = matteBox[at].roll * DEG2RAD
    const length = matteBox[at].length * METRES_PER_CENTIMETRE
    putVec4(
      into,
      AT.matteAngles + 4 * at,
      Math.sin(pitch),
      Math.cos(pitch),
      Math.sin(roll),
      Math.cos(roll),
    )
    putVec4(into, AT.matteSizes + 4 * at, 1 / Math.sin(pitch), length)
    active ||= length > 0
  }
  return active
}

/** The words of the sizes: the image's and the textures it lies in, the gather's, the tiles' and the
 *  first mip level's, the setup accumulation's, the display's and the history's. */
function writeSizes(into: Float32Array, ints: Uint32Array, input: DofParamsInput) {
  const { plan, extent, display, historyDisplay } = input
  putVec4(ints, AT.image, plan.full[0], plan.full[1], extent[0], extent[1])
  putVec4(ints, AT.gather, plan.gather[0], plan.gather[1], plan.buffer[0], plan.buffer[1])
  putVec4(
    ints,
    AT.tiles,
    ceilDiv(plan.gather[0], COC_TILE),
    ceilDiv(plan.gather[1], COC_TILE),
    plan.reduced[0],
    plan.reduced[1],
  )
  putVec4(ints, AT.pre, plan.pre[0], plan.pre[1], plan.preBuffer[0], plan.preBuffer[1])
  putVec4(into, AT.display, display[0], display[1], historyDisplay[0], historyDisplay[1])
}

/** The temporal accumulation's words (`temporal`, `current`): the jitter, the cut, the bilateral
 *  strength; the weight of the image in the history. */
function writeTemporal(into: Float32Array, input: DofParamsInput) {
  const { plan, settings, jitter, cut } = input
  putVec4(
    into,
    AT.temporal,
    plan.temporal ? jitter[0] : 0,
    plan.temporal ? jitter[1] : 0,
    cut ? 1 : 0,
    settings.depthOfFieldBilateralStrength,
  )
  putVec4(into, AT.current, settings.depthOfFieldTemporalCurrentWeight)
}

/**
 * Writes the uniform's words (`DOF_PARAMS`) into `into`, `ints` its unsigned view: the sizes (the
 * image's, the gather's, the tiles', the first mip level's, the setup accumulation's, the display's),
 * the circle of confusion's model at the gather's width and the setup's, the bokeh's, the scatter's tests, the
 * recombine's, the swirl, the lens and the barrel and matte box — the barrel's length written as −1
 * where there is no vignette —, the projection's depth terms and the ratio of the depth's size to the
 * image's. Nothing is allocated.
 */
export function writeDofParams(into: Float32Array, ints: Uint32Array, input: DofParamsInput) {
  const { plan, settings, volume, render } = input
  const { coc, bokeh } = plan
  const image = plan.full
  writeSizes(into, ints, input)
  putVec4(ints, AT.counts, Math.floor(plan.scatterGroups), 0, input.frame, 0)
  putVec4(
    into,
    AT.depthMap,
    render[0] / image[0],
    render[1] / image[1],
    render[0] - 1,
    render[1] - 1,
  )
  putVec4(
    into,
    AT.coc,
    coc.infinityRadius,
    coc.minForeground,
    coc.maxBackground,
    coc.depthBlurRadius,
  )
  putVec4(into, AT.lens, coc.squeeze, 1 / coc.squeeze, coc.depthBlurExponent, coc.focusDistance)
  const reach = errorMultiplierOf(plan.rings) * circleRatio(plan)
  putVec4(into, AT.basis, plan.gather[0], reach, 1 / reach, plan.pre[0])
  putVec4(into, AT.bokeh, bokeh.bladeCount, bokeh.rotation, bokeh.circumscribed, bokeh.incircle)
  putVec4(into, AT.blade, bokeh.bladeRadius, bokeh.bladeCenterOffset)
  putVec4(
    into,
    AT.scatter,
    settings.depthOfFieldScatterMinRadius,
    settings.depthOfFieldScatterNeighborColor,
    settings.depthOfFieldDistinctionLimit,
    input.exposure,
  )
  putVec4(
    into,
    AT.recombine,
    settings.depthOfFieldSlightFocusRejection,
    settings.depthOfFieldRecombineMinBlur,
  )
  putVec4(
    into,
    AT.petzval,
    volume.petzvalBokeh,
    volume.petzvalFalloff,
    volume.petzvalExclusionBoxWidth,
    volume.petzvalExclusionBoxHeight,
  )
  putVec4(into, AT.petzvalMore, volume.petzvalExclusionRadius)
  putVec4(into, AT.optics, coc.sensorWidth, coc.sensorHeight, coc.aperture, coc.lensImageDistance)
  const matte = writeMatteBox(into, volume)
  putVec4(into, AT.barrel, coc.barrelRadius, coc.barrelLength > 0 || matte ? coc.barrelLength : -1)
  putDepthTerms(into, AT, scratch, input.projection, input.perspective, render[0])
  writeTemporal(into, input)
}

/** What a repeating pass's step holds. */
export interface DofStepInput {
  /** `a`: the step's floats; `b`: its words. */
  readonly a: readonly [number, number, number, number]
  readonly b: readonly [number, number, number, number]
}

/** Writes a step's words (`DOF_STEP`) into `into`, `ints` its unsigned view. */
export function writeDofStep(into: Float32Array, ints: Uint32Array, { a, b }: DofStepInput) {
  into.set(a, STEP.a)
  ints.set(b, STEP.b)
}

/** The step of a dilation: the tiles between the ones it reads. */
export const dilateStep = (multiplier: number): DofStepInput => ({
  a: [multiplier, 0, 0, 0],
  b: [0, 0, 0, 0],
})

/**
 * The step of one reduction of the setup, read at its `inputMip` level: the last texel it may read
 * — the setup accumulation's width and height less half a texel, at the level's size —, the size of
 * its pass, and the quarter-size copy's mapping the scatter's neighbour test reads (the ratio of the
 * quarter's size to the setup's, and its last texel).
 */
export function reduceStep(plan: DofPlan, inputMip: number): DofStepInput {
  const [px, py] = plan.pre
  const level = 2 ** inputMip
  // The region of the quarter-size copy the setup writes: the rounded-up half of the setup's size.
  const quarter = [ceilDiv(px, 2), ceilDiv(py, 2)]
  return {
    a: [
      (quarter[0] - 0.5) / (px - 0.5),
      (quarter[1] - 0.5) / (py - 0.5),
      Math.max(quarter[0] - 1, 0),
      Math.max(quarter[1] - 1, 0),
    ],
    b: [
      Math.floor((px - 0.5) / level),
      Math.floor((py - 0.5) / level),
      ceilDiv(px, level),
      ceilDiv(py, level),
    ],
  }
}

/** The sprite groups the draw lists hold: the budget and the room a last instance's unused groups
 *  take. */
export const spriteCapacity = (plan: DofPlan) =>
  Math.floor(plan.scatterGroups) + SCATTER_GROUP_MARGIN
