import type { DistanceFieldOcclusionSettings } from '../../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import {
  eyeFrame,
  putPlanes,
  putScaledColumns,
  putScaledRows,
  writeWorldToView,
} from '../viewParams.ts'
import {
  AO_DOWNSAMPLE,
  BOUNDING_SPHERE_RINGS,
  CONE_HALF_ANGLE,
  CONE_STEPS,
  bentNormalNormalizeFactor,
  coneDirections,
  coneGridJitter,
  occlusionBuffers,
  putConeDirections,
  tileCounts,
} from './cones.ts'
import { DFAO_FLAG, DFAO_PARAMS } from './layout.ts'

/** What an image tells the occlusion of the camera, in metres: the view-projections of this image and the last
 *  (world to clip, column-major), the camera's world matrix and projection, the depth range, whether the projection is a
 *  perspective, the sizes drawn and the scene buffers are made at, and the image's place in the sequences. */
export interface DfaoImage {
  view: readonly [number, number]
  extent: readonly [number, number]
  viewProjection: ArrayLike<number>
  previousViewProjection: ArrayLike<number>
  world: ArrayLike<number>
  projection: ArrayLike<number>
  near: number
  far: number
  perspective: boolean
  /** The image's number, which the cone directions' jitter follows; and its rank among the four of the cone grid's. */
  frame: number
  temporalIndex: number
  /** The surfaces' vectors of motion are there to read. */
  velocity: boolean
}

/** What the history gives the image: the size, in cells of the grid, of the view the last image drew, or none. */
export interface DfaoHistory {
  lastView: readonly [number, number] | undefined
}

/** What the passes of the image are told of the scene and the light. */
export interface DfaoScene {
  /** The meshes in the scene, and the index count of the bounding sphere's draw. */
  objects: number
  sphereIndices: number
  /** The occlusion distances of the sky light for the meshes' fields and the global one, in centimetres
   *  (`occlusionDistances`). */
  distances: { object: number; global: number }
}

const CM = CENTIMETRES_PER_METRE
const scratch = new Float64Array(16)
const inverse = new Float64Array(16)
const current = new Float64Array(16)
const previous = new Float64Array(16)
const clipScaled = new Float32Array(16)

/** The eye's frame: the world-to-view matrix and its inverse. */
function putViewFrames(out: Float32Array, image: DfaoImage) {
  const at = DFAO_PARAMS.at
  const frame = eyeFrame(image.world)
  writeWorldToView(out, at.worldToView, frame)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[at.viewToWorld + r * 4 + c] = frame.axes[r][c]
    out[at.viewToWorld + 12 + r] = frame.eye[r]
  }
  out[at.viewToWorld + 15] = 1
}

/** The matrices of the image: the unprojection of this image and the last, the view-projection in centimetres, the
 *  motion of a clip position between the two, the eye's frame and the frustum; the frustum's planes are counted. */
function putMatrices(out: Float32Array, image: DfaoImage) {
  const at = DFAO_PARAMS.at
  current.set(image.viewProjection)
  previous.set(image.previousViewProjection)
  invertMatrix4(inverse, current)
  putScaledRows(out, at.unprojectToWorld, inverse, CM)
  putScaledColumns(out, at.viewProjection, current, 1 / CM)
  multiplyMatrix4(scratch, previous, inverse)
  out.set(scratch, at.clipToPreviousClip)
  invertMatrix4(inverse, previous)
  putScaledRows(out, at.previousUnproject, inverse, CM)
  putViewFrames(out, image)
  putScaledColumns(clipScaled, 0, image.viewProjection, 1 / CM)
  return putPlanes(out, at.planes, clipScaled)
}

/** The step the cones' samples start at and the spacing exponent gives: the farthest sample of a cone over the
 *  mesh-field occlusion distance (`AOStepScale`). */
function stepScale(objectDistance: number, exponent: number) {
  return objectDistance / (1 + Math.tan(CONE_HALF_ANGLE)) / 2 ** (exponent * (CONE_STEPS - 1))
}

/** How the last image's view falls in the history (`HistoryScreenPositionScaleBias`, `HistoryUVMinMax`), in cells
 *  of a grid of `grid`; with no last view the history is not read, and these are zeros. */
function putHistoryView(out: Float32Array, last: DfaoHistory['lastView'], grid: readonly number[]) {
  const at = DFAO_PARAMS.at
  if (!last) {
    putVec4(out, at.historyScale, 0, 0, 0, 0)
    putVec4(out, at.historyUv, 0, 0, 0, 0)
    return
  }
  const [w, h] = last
  putVec4(out, at.historyScale, w / grid[0] / 2, h / grid[1] / -2, h / 2 / grid[1], w / 2 / grid[0])
  putVec4(out, at.historyUv, 0.5 / grid[0], 0.5 / grid[1], (w - 0.5) / grid[0], (h - 0.5) / grid[1])
}

/** Writes the jitter, the history's weights, the view's bounds, the lens and the depth's range of the uniform. */
function putImageParams(
  floats: Float32Array,
  image: DfaoImage,
  settings: DistanceFieldOcclusionSettings,
  history: DfaoHistory,
  grid: readonly number[],
) {
  const at = DFAO_PARAMS.at
  const [jx, jy] = coneGridJitter(image.temporalIndex, settings.useJitter, settings.useHistory)
  putVec4(floats, at.jitter, jx, jy, 1 / Math.cos(Math.PI / BOUNDING_SPHERE_RINGS))
  putVec4(
    floats,
    at.history,
    settings.historyWeight,
    settings.historyDistanceThreshold,
    settings.stabilityPass ? 1 : 0,
  )
  const view = [
    Math.floor(image.view[0] / AO_DOWNSAMPLE),
    Math.floor(image.view[1] / AO_DOWNSAMPLE),
  ]
  putHistoryView(floats, history.lastView, grid)
  putVec4(
    floats,
    at.uvMax,
    (view[0] - 0.51) / grid[0],
    (view[1] - 0.51) / grid[1],
    (view[0] - 0.5 - AO_DOWNSAMPLE) / grid[0],
    (view[1] - 0.5 - AO_DOWNSAMPLE) / grid[1],
  )
  putVec4(floats, at.lens, image.projection[0], image.projection[5], image.near * CM)
  if (image.perspective) putVec4(floats, at.depth, image.near, 0, 1)
  else putVec4(floats, at.depth, image.far - image.near, image.near, 0)
}

/**
 * Writes the uniform of the image (`DFAO_PARAMS`) into `floats` and `words`, two views of the same buffer:
 * everything the passes read of the settings, the image, the scene and the sky light's distances. The share of
 * the last image kept, the cones' directions and the jitter follow the image's rank. `useHistory` says the history
 * is read this image (the settings' and the last image there).
 */
export function writeDfaoParams(
  floats: Float32Array,
  words: Uint32Array,
  image: DfaoImage,
  settings: DistanceFieldOcclusionSettings,
  scene: DfaoScene,
  history: DfaoHistory,
) {
  const at = DFAO_PARAMS.at
  const planes = putMatrices(floats, image)
  const directions = coneDirections(
    settings.relaxedSampleSet,
    settings.jitterConeDirections,
    image.frame,
  )
  putConeDirections(floats, at.directions, directions)
  const { grid, cones } = occlusionBuffers(image.extent)
  const tiles = tileCounts(image.view[0], image.view[1])
  const flags =
    (image.velocity ? DFAO_FLAG.velocity : 0) |
    (image.view[0] / AO_DOWNSAMPLE < grid[0] || image.view[1] / AO_DOWNSAMPLE < grid[1]
      ? DFAO_FLAG.clampView
      : 0)
  words.set([grid[0], grid[1], image.view[0], image.view[1]], at.grid)
  words.set([cones[0], cones[1], tiles[0], tiles[1]], at.cones)
  words.set([planes, scene.objects, scene.sphereIndices, flags], at.counts)
  const exponent = settings.stepExponentScale
  putVec4(
    floats,
    at.distances,
    scene.distances.object,
    stepScale(scene.distances.object, exponent),
    exponent,
    settings.maxViewDistance,
  )
  const fade = 1 / ((1 - settings.viewFadeDistanceScale) * settings.maxViewDistance)
  putVec4(
    floats,
    at.global,
    scene.distances.global,
    Math.tan(CONE_HALF_ANGLE),
    bentNormalNormalizeFactor(directions),
    fade,
  )
  putImageParams(floats, image, settings, history, grid)
}
