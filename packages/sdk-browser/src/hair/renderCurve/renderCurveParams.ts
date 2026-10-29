import type { wordViews } from '../../gpu/core/wordViews.ts'
import { renderCurveHzbLevels } from './hzbWgsl.ts'
import type { RenderCurveCommon } from './renderCurveMath.ts'

/** The most bin tiles a side that a tile's coordinates, on eight bits, can name. */
export const RENDER_CURVE_MAX_TILES_PER_SIDE = 256

/** What an image of the curve raster reads of the view and the scene. */
export interface RenderCurveView {
  /** The view-projection of the image, the eye at the origin, column-major (`HairFrameInputs.viewProjection`). */
  readonly viewProjection: ArrayLike<number>
  /** The projection (to read its depth map from) and whether it is a perspective one. */
  readonly projection: ArrayLike<number>
  readonly perspective: boolean
  readonly eye: ArrayLike<number>
}

/**
 * Writes the shared block (`RenderCurveParams`): the transform to clip space, the sizes and limits of `common`, and the counts of the
 * scene. The depth of a perspective projection is a line of its clip distance (`zScale` times it plus `zBias`), which the boxes' depth
 * range is read from.
 */
export function writeRenderCurveParams(
  words: ReturnType<typeof wordViews>,
  common: RenderCurveCommon,
  view: RenderCurveView,
  scene: { instanceCount: number; clusterCount: number; strideWords: number; maxVisible: number },
) {
  const { f, u } = words
  const { projection } = view
  for (let i = 0; i < 16; i++) f[i] = view.viewProjection[i]!
  u[16] = common.resolution[0]
  u[17] = common.resolution[1]
  u[18] = common.binTileRes[0]
  u[19] = common.binTileRes[1]
  f[20] = view.perspective ? projection[10]! / projection[11]! : 0
  f[21] = projection[14]!
  u[22] = view.perspective ? 0 : 1
  u[23] = scene.instanceCount
  u[24] = common.numBinners
  u[25] = scene.clusterCount
  u[26] = scene.strideWords
  u[27] = scene.maxVisible
  u[28] = common.maxTileAllocCount
  u[29] = common.maxSegmentDataCount
  u[30] = common.maxZBinDataCount
  u[31] = common.maxRasterWorkCount
  u[32] = common.maxZBinSegmentDataCount
  u[33] = renderCurveHzbLevels(common.resolution[0], common.resolution[1])
}
