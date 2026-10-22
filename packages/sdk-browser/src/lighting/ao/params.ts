import type { AmbientOcclusionSettings } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { AO_PARAMS } from './layout.ts'
import { aoTargetExtent, aoTargetRect, AO_TARGETS, type AoPass, type AoTarget } from './plan.ts'
import { TAA_VIEW } from '../../post/taa/bindingsWgsl.ts'
import { writeDepthTerms } from '../../post/taa/view.ts'
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
}

const TERMS = TAA_VIEW.at
/** Where the temporal passes' depth terms are written, before the two words the occlusion takes of them are copied. */
const terms = new Float32Array(TAA_VIEW.words)

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

/** The size of the texture and of the rectangle `target` draws, or the stand-in of none (one). */
function sizesOf(target: AoTarget | undefined, image: AoImage) {
  if (!target) return [1, 1, 1, 1] as const
  const [w, h] = aoTargetExtent(target, image.extent)
  const [rw, rh] = aoTargetRect(target, image.view)
  return [w, h, rw, rh] as const
}

/** The words that follow from the settings alone: the shape, the radius the pass takes, the fade and the depth threshold. */
function settingWords(out: Float32Array, scale: number, settings: AmbientOcclusionSettings) {
  const at = AO_PARAMS.at
  const inWorld = settings.radiusInWorldSpace
  const radius =
    ((inWorld ? settings.radiusCm : settings.radiusCm / VIEW_SPACE_UNITS) *
      settings.mipScale ** Math.log2(scale)) /
    RADIUS_SHARE
  const fadeRadius = Math.max(1, settings.fadeRadiusCm)
  const fadeMultiplier = 1 / fadeRadius
  const { power, bias, intensity, mipBlend, mipLevelFactor, mipThreshold } = settings
  putVec4(out, at.shape, power, bias / 1000, intensity, mipBlend)
  putVec4(out, at.reach, radius, +inWorld, scale, clamp(mipLevelFactor, 0, 100))
  const fadeAdd = -(settings.fadeDistanceCm - fadeRadius) * fadeMultiplier
  putVec4(out, at.fade, fadeMultiplier, fadeAdd, mipThreshold / scale)
}

/** The words that follow from the image and the pass's place in it: the lens, the rectangles and textures, the noise's
 *  offset, the camera's axes and the depth's terms. */
function imageWords(out: Float32Array, pass: AoPass, image: AoImage) {
  const at = AO_PARAMS.at
  const [width, height, rectWidth, rectHeight] = sizesOf(pass.target, image)
  putVec4(out, at.lens, image.projection[0], image.projection[5], image.view[0], image.view[1])
  putVec4(out, at.rects, rectWidth, rectHeight, width, height)
  putVec4(out, at.low, ...sizesOf(pass.lower, image))
  const [upperWidth, upperHeight] = sizesOf(pass.setup, image)
  putVec4(out, at.upper, upperWidth, upperHeight)
  const step = image.noiseIndex % AO_TEMPORAL_IMAGES
  putVec4(out, at.noise, step * AO_TEMPORAL_STEP[0], step * AO_TEMPORAL_STEP[1], AO_NOISE_SIDE)
  axisOf(out, at.right, image.world, 0, 1)
  axisOf(out, at.up, image.world, 1, 1)
  // The camera looks down its own -z.
  axisOf(out, at.forward, image.world, 2, -1)
  // The projection's depth terms, the engine's one reading of a device depth (`sceneDepthOf`).
  writeDepthTerms(terms, image.projection, image.perspective, image.view[0])
  out.set(terms.subarray(TERMS.depth, TERMS.depth + 4), at.depth)
  out.set(terms.subarray(TERMS.radius, TERMS.radius + 4), at.radius)
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
) {
  settingWords(out, AO_TARGETS[pass.target].scale, settings)
  imageWords(out, pass, image)
}
