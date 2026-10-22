import { dotVector3 } from '../../../../../math/src/vector/vector.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import type { CloudShadowLightFrame } from './shadowFrame.ts'

/**
 * THE CLOUD SHADOW MAP'S TEMPORAL FILTER, planned: what a view keeps of a light's map from one
 * image to the next, and what the filter pass is told of it. Nothing here touches the GPU.
 *
 * The filter is on when the weight of the current image (`cloudShadowMapNewFrameWeight`) is under
 * 1. The trace is then at half the map's size per axis, and each image traces one of the four
 * pixels of every 2×2 (the image index modulo 4: x one for the images 1 and 2, y one for 1 and 3).
 * With a view that keeps state, a pass blends it into the map of the image before, reprojected
 * through that image's map matrix: where the traced pixel is the one traced now the blend is
 * `previous + weight (current - previous)` on the extinction and the optical depth and the current
 * depth is kept as it is; elsewhere the previous is kept. The history is dropped when the light has
 * turned by more than `cutDegrees` (the quality's `cloudShadowMapLightRotationCutDegrees`) since the image before, when the map is of
 * another size or was not made. When the point the map looks at has moved, the previous front
 * depth is expressed again along the current rays. A view with no state traces the half-size map
 * and keeps it as it is.
 */

/** The squared distance, in centimetres, under which the point the map looks at has not moved. */
const ANCHOR_STILL = 0.0001
const CM_TO_KM = 0.00001

/** What a view keeps of one light's map. */
export interface CloudShadowHistory {
  /** The previous image made a map of `side` texels with the filter, which the pass can read. */
  valid: boolean
  side: number
  clipFromCamera: Float64Array
  direction: [number, number, number]
  lightPosition: [number, number, number]
  anchor: [number, number, number]
}

export const createCloudShadowHistory = (): CloudShadowHistory => ({
  valid: false,
  side: 0,
  clipFromCamera: new Float64Array(16),
  direction: [0, 0, 0],
  lightPosition: [0, 0, 0],
  anchor: [0, 0, 0],
})

/** What the filter does for one image of one light. */
export interface CloudShadowTemporal {
  /** The side of the traced map, and the scale and offset from its pixels to the map's. */
  readonly tracedSide: number
  readonly pixel: readonly [number, number, number, number]
  /** The weight of the current image. */
  readonly weight: number
  /** The filter pass runs: the weight is under 1 and the view keeps state. */
  readonly filtered: boolean
  /** The history is read. */
  readonly history: boolean
  readonly anchorMoved: boolean
  /** The previous front depth along the current rays: `depth = from + scale · previous`. */
  readonly depthFrom: number
  readonly depthScale: number
  /** The previous image's map matrix. */
  readonly previousClipFromCamera: Float64Array
}

const IDENTITY_PIXEL = [1, 1, 0, 0] as const

/**
 * The filter of the image `frameIndex` of the light whose map is `frame`, `side` texels, with
 * `weight` the current image's, `history` the view's (none: a view with no state). `cutDegrees`
 * (`cloudShadowMapLightRotationCutDegrees`) is the turn of the light past which the history is dropped.
 */
export function planCloudShadowTemporal(
  frame: CloudShadowLightFrame,
  side: number,
  weight: number,
  history: CloudShadowHistory | undefined,
  frameIndex: number,
  cutDegrees: number,
): CloudShadowTemporal {
  const none = {
    tracedSide: side,
    pixel: IDENTITY_PIXEL,
    weight,
    filtered: false,
    history: false,
    anchorMoved: false,
    depthFrom: 0,
    depthScale: 1,
    previousClipFromCamera: frame.clipFromCamera,
  }
  if (!(weight < 1)) return none
  const status = history ? frameIndex % 4 : 0
  const traced = {
    ...none,
    tracedSide: side >> 1,
    pixel: [2, 2, status === 1 || status === 2 ? 1 : 0, status === 1 || status === 3 ? 1 : 0],
  } as const
  if (!history) return traced
  const cut = dotVector3(history.direction, frame.rayDirection) < Math.cos(cutDegrees * DEG2RAD)
  const usable = history.valid && history.side === side && !cut
  const moved =
    (history.anchor[0] - frame.anchor[0]) ** 2 +
      (history.anchor[1] - frame.anchor[1]) ** 2 +
      (history.anchor[2] - frame.anchor[2]) ** 2 >=
    ANCHOR_STILL
  const behind = [
    history.lightPosition[0] - frame.lightPosition[0],
    history.lightPosition[1] - frame.lightPosition[1],
    history.lightPosition[2] - frame.lightPosition[2],
  ]
  return {
    ...traced,
    filtered: true,
    history: usable,
    anchorMoved: moved,
    depthFrom: dotVector3(behind, frame.rayDirection) * CM_TO_KM,
    depthScale: dotVector3(history.direction, frame.rayDirection),
    previousClipFromCamera: usable ? history.clipFromCamera : frame.clipFromCamera,
  }
}

/** After the image: the view keeps this image's map for the next. `frame` is none where the light
 *  has no map; `filtered` says the image made the map the next one reads as its history. */
export function commitCloudShadowHistory(
  history: CloudShadowHistory,
  frame: CloudShadowLightFrame | undefined,
  side: number,
  filtered: boolean,
) {
  history.valid = frame !== undefined && filtered
  history.side = side
  if (frame) {
    history.clipFromCamera.set(frame.clipFromCamera)
    history.direction = [...frame.rayDirection]
    history.lightPosition = [...frame.lightPosition]
    history.anchor = [...frame.anchor]
  } else {
    history.clipFromCamera.fill(0)
    history.direction = [0, 0, 0]
    history.lightPosition = [0, 0, 0]
    history.anchor = [0, 0, 0]
  }
}
