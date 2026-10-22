import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import type { ResolvedDepthOfField } from '../../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import type { DepthOfFieldValues } from '../../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { TAA_VIEW } from '../../taa/bindingsWgsl.ts'
import { writeDepthTerms } from '../../taa/view.ts'
import { METRES_PER_CENTIMETRE } from './cocModel.ts'
import type { DofPlan } from './dofPlan.ts'
import { DOF_PARAMS, DOF_STEP, SCATTER_GROUP_MARGIN } from './dofLayout.ts'

/** The `x`th word of a field of the uniform. */
const AT = DOF_PARAMS.at
const STEP = DOF_STEP.at
/** The projection's depth terms are written by the temporal passes' writer into a block laid out as
 *  their uniform, and read off it. */
const TERMS = TAA_VIEW.at
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
  /** The image's rank among eight, which the recombine's sample pattern turns by. */
  readonly frame: number
}

/** The matte box's three flags as the sine and cosine of each flag's pitch and roll, and the
 *  reciprocal of the pitch's sine and its length, the pitch measured from the barrel's side. */
function writeMatteBox(into: Float32Array, volume: ResolvedDepthOfField) {
  let active = false
  volume.matteBox.forEach((flag, at) => {
    const pitch = (flag.pitch + 90) * DEG2RAD
    const roll = flag.roll * DEG2RAD
    const length = flag.length * METRES_PER_CENTIMETRE
    into.set(
      [Math.sin(pitch), Math.cos(pitch), Math.sin(roll), Math.cos(roll)],
      AT.matteAngles + 4 * at,
    )
    into.set([1 / Math.sin(pitch), length, 0, 0], AT.matteSizes + 4 * at)
    active ||= length > 0
  })
  return active
}

/**
 * Writes the uniform's words (`DOF_PARAMS`) into `into`, `ints` its unsigned view: the sizes (the
 * image's, the gather's, the tiles', the first mip level's), the circle of confusion's model at the
 * gather's width, the bokeh's, the scatter's tests, the recombine's, the swirl, the lens and the barrel
 * and matte box — the barrel's length written as −1 where there is no vignette —, the projection's depth
 * terms and the ratio of the depth's size to the image's.
 */
export function writeDofParams(into: Float32Array, ints: Uint32Array, input: DofParamsInput) {
  const { plan, settings, volume, render, extent } = input
  const { coc, bokeh } = plan
  const image = plan.full
  ints.set([image[0], image[1], extent[0], extent[1]], AT.image)
  ints.set([plan.gather[0], plan.gather[1], plan.buffer[0], plan.buffer[1]], AT.gather)
  ints.set([plan.tiles[0], plan.tiles[1], plan.reduced[0], plan.reduced[1]], AT.tiles)
  ints.set([Math.floor(plan.scatterGroups), 0, input.frame, 0], AT.counts)
  into.set([render[0] / image[0], render[1] / image[1], render[0] - 1, render[1] - 1], AT.depthMap)
  into.set([coc.infinityRadius, coc.minForeground, coc.maxBackground, coc.depthBlurRadius], AT.coc)
  into.set([coc.squeeze, 1 / coc.squeeze, coc.depthBlurExponent, coc.focusDistance], AT.lens)
  into.set([plan.gather[0], plan.errorMultiplier, 1 / plan.errorMultiplier, 0], AT.basis)
  into.set([bokeh.bladeCount, bokeh.rotation, bokeh.circumscribed, bokeh.incircle], AT.bokeh)
  into.set([bokeh.bladeRadius, bokeh.bladeCenterOffset, 0, 0], AT.blade)
  into.set(
    [
      Math.max(settings.depthOfFieldScatterMinRadius, 3),
      settings.depthOfFieldScatterNeighborColor,
      settings.depthOfFieldDistinctionLimit,
      input.exposure,
    ],
    AT.scatter,
  )
  into.set(
    [settings.depthOfFieldSlightFocusRejection, settings.depthOfFieldRecombineMinBlur, 0, 0],
    AT.recombine,
  )
  into.set(
    [
      volume.petzvalBokeh,
      volume.petzvalFalloff,
      volume.petzvalExclusionBoxWidth,
      volume.petzvalExclusionBoxHeight,
    ],
    AT.petzval,
  )
  into.set([volume.petzvalExclusionRadius, 0, 0, 0], AT.petzvalMore)
  into.set([coc.sensorWidth, coc.sensorHeight, coc.aperture, coc.lensImageDistance], AT.optics)
  const matte = writeMatteBox(into, volume)
  into.set(
    [coc.barrelRadius, coc.barrelLength > 0 || matte ? coc.barrelLength : -1, 0, 0],
    AT.barrel,
  )
  writeDepthTerms(scratch, input.projection, input.perspective, render[0])
  into.set(scratch.subarray(TERMS.depth, TERMS.depth + 4), AT.depth)
  into.set(scratch.subarray(TERMS.radius, TERMS.radius + 4), AT.radius)
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
 * — the gather's width and height less half a texel, at the level's size —, the size of its pass,
 * and the quarter-size copy's mapping the scatter's neighbour test reads (the ratio of the quarter's
 * size to the gather's, and its last texel).
 */
export function reduceStep(plan: DofPlan, inputMip: number): DofStepInput {
  const [gx, gy] = plan.gather
  const level = 2 ** inputMip
  const quarter = [Math.floor(gx / 2), Math.floor(gy / 2)]
  return {
    a: [
      (quarter[0] - 0.5) / (gx - 0.5),
      (quarter[1] - 0.5) / (gy - 0.5),
      Math.max(quarter[0] - 1, 0),
      Math.max(quarter[1] - 1, 0),
    ],
    b: [
      Math.floor((gx - 0.5) / level),
      Math.floor((gy - 0.5) / level),
      ceilDiv(gx, level),
      ceilDiv(gy, level),
    ],
  }
}

/** The sprite groups the draw lists hold: the budget and the room a last instance's unused groups
 *  take. */
export const spriteCapacity = (plan: DofPlan) =>
  Math.floor(plan.scatterGroups) + SCATTER_GROUP_MARGIN
