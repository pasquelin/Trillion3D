import type { AmbientOcclusionSettings } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { AO_PARAMS } from './layout.ts'
import { AO_TARGETS, scaledRect, type AoPass, type AoTarget } from './plan.ts'
import { TAA_VIEW } from '../../post/taa/bindingsWgsl.ts'
import { writeDepthTerms } from '../../post/taa/view.ts'
import type { CameraImage } from '../../frame/backend/state/previousCamera.ts'
import { AO_NOISE_SIDE, AO_TEMPORAL_IMAGES, AO_TEMPORAL_STEP } from './tables.ts'

/** What an image tells the passes: the size drawn and the textures' base size, the camera's projection and pose,
 *  and the rank of the image in the noise's temporal sequence. */
export interface AoImage {
  /** The size drawn, in pixels. */
  view: readonly [number, number]
  /** The scene's extent the textures are cut from (`aoExtentOf`). */
  extent: readonly [number, number]
  /** The camera's projection and world matrix, column-major: its scale on x and y, its axes. */
  projection: ArrayLike<number>
  world: ArrayLike<number>
  /** Whether the projection is a perspective (`EngineCamera.perspective`). */
  perspective: boolean
  /** The image's rank in the temporal sequence (the temporal pass's), 0 with none. */
  noiseIndex: number
  /** What the horizon method reads beside (`horizon/params.ts`): the engine's frame counter, this image's view-projection,
   *  whether its history is dropped this image (a camera cut, or a history whose last image is not the image before) and the
   *  camera its history's image was drawn with — the view's camera of the image before, where that is its image: none
   *  otherwise (`cameraSeen`). */
  frame: number
  viewProjection: ArrayLike<number>
  historyCut: boolean
  before: CameraImage | undefined
  /** Whether the image accumulates in time (the temporal antialiasing runs): the compute pass is then not smoothed. */
  accumulates: boolean
}

const TERMS = TAA_VIEW.at
/** The words the temporal passes' depth terms are written into, before the two vectors the occlusion takes of them are copied:
 *  one for each method's scratch (`writeAoParams`, `writeHorizonParams`). */
export const createDepthTerms = () => new Float32Array(TAA_VIEW.words)

/** The share of the depth a view-space radius is, per the 400 units of the view the reference locks it to. */
const VIEW_SPACE_UNITS = 400
/** Divides the radius, to leave room for the coarser levels' wider radii. */
const RADIUS_SHARE = 4

/** The unit vector along a matrix column: `scale` flips it. */
function axisOf(
  out: Float32Array,
  at: number,
  m: ArrayLike<number>,
  column: number,
  scale: number,
) {
  const x = m[column * 4] * scale,
    y = m[column * 4 + 1] * scale,
    z = m[column * 4 + 2] * scale
  const length = length3(x, y, z) || 1
  // `+ 0` turns a negative zero, the sign a flipped axis leaves, into zero.
  putVec4(out, at, x / length + 0, y / length + 0, z / length + 0)
}

/** The reduction of a target of the plan to the scene's size, none for none. */
const scaleOf = (target: AoTarget | undefined) => target && AO_TARGETS[target].scale

/** Writes the size of a texture `scale` times smaller than the scene's and of the rectangle drawn in it (`rectFirst` puts the
 *  rectangle first) into `out` at `at`, or the stand-in of none (one, where `scale` is `undefined`): both methods' rectangles. */
export function putTarget(
  out: Float32Array,
  at: number,
  scale: number | undefined,
  image: AoImage,
  rectFirst: boolean,
) {
  if (scale === undefined) return putVec4(out, at, 1, 1, 1, 1)
  const size = rectFirst ? at + 2 : at
  out[size] = image.extent[0] / scale
  out[size + 1] = image.extent[1] / scale
  scaledRect(scale, image.view, out, rectFirst ? at : at + 2)
}

/** The words that follow from the settings alone: the shape, the radius the pass takes, the fade and the depth threshold. */
function settingWords(out: Float32Array, scale: number, settings: AmbientOcclusionSettings) {
  const at = AO_PARAMS.at
  const inWorld = settings.radiusInWorldSpace
  const radius =
    ((inWorld ? settings.radiusCm : settings.radiusCm / VIEW_SPACE_UNITS) *
      settings.mipScale ** Math.log2(scale)) /
    RADIUS_SHARE
  const { power, bias, intensity, mipBlend, mipLevelFactor, mipThreshold } = settings
  putVec4(out, at.shape, power, bias / 1000, intensity, mipBlend)
  putVec4(out, at.reach, radius, +inWorld, scale, clamp(mipLevelFactor, 0, 100))
  putVec4(out, at.fade, settings.fadeMultiplier, settings.fadeAddend, mipThreshold / scale)
}

/** Where the camera's words lie in a pass's uniform, whichever method's: the lens, the axes and the depth terms. */
interface CameraWords {
  lens: number
  right: number
  up: number
  forward: number
  depth: number
  radius: number
}

/** The camera's words: the lens (the projection's scale on x and y, and the drawn size), its axes in the world and the
 *  projection's depth terms, the engine's one reading of a device depth (`sceneDepthOf`). */
export function putCamera(out: Float32Array, at: CameraWords, image: AoImage, terms: Float32Array) {
  putVec4(out, at.lens, image.projection[0], image.projection[5], image.view[0], image.view[1])
  axisOf(out, at.right, image.world, 0, 1)
  axisOf(out, at.up, image.world, 1, 1)
  // The camera looks down its own -z.
  axisOf(out, at.forward, image.world, 2, -1)
  writeDepthTerms(terms, image.projection, image.perspective, image.view[0])
  for (let k = 0; k < 4; k++) {
    out[at.depth + k] = terms[TERMS.depth + k]
    out[at.radius + k] = terms[TERMS.radius + k]
  }
}

/** The words that follow from the image and the pass's place in it: the camera, the rectangles and textures, the noise's
 *  offset. */
function imageWords(out: Float32Array, pass: AoPass, image: AoImage, terms: Float32Array) {
  const at = AO_PARAMS.at
  putCamera(out, at, image, terms)
  putTarget(out, at.rects, scaleOf(pass.target), image, true)
  putTarget(out, at.low, scaleOf(pass.lower), image, false)
  putTarget(out, at.upper, scaleOf(pass.setup), image, false)
  const step = image.noiseIndex % AO_TEMPORAL_IMAGES
  putVec4(out, at.noise, step * AO_TEMPORAL_STEP[0], step * AO_TEMPORAL_STEP[1], AO_NOISE_SIDE)
}

/**
 * Writes the uniform of `pass` into `out` (`AO_PARAMS`): the settings as the reference's shader takes
 * them — the radius divided by the 400 units of the view, or the world's, then grown by the mip scale
 * once for each halving and shared out by four; the fade as a multiplier and an addend of the depth,
 * the fade radius held to a centimetre; the bias in thousandths — and the geometry of the pass: the
 * rectangle it draws, the coarser result and the neighbours it reads, the camera and the noise's offset
 * for this image.
 */
export function writeAoParams(
  out: Float32Array,
  pass: AoPass,
  settings: AmbientOcclusionSettings,
  image: AoImage,
  terms: Float32Array,
) {
  settingWords(out, AO_TARGETS[pass.target].scale, settings)
  imageWords(out, pass, image, terms)
}
