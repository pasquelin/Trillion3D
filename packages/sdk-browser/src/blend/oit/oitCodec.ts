import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'

/**
 * The distance in front of the camera, in centimetres, of a sample whose normalized depth is `z` (the figure the debug shows is the scene depth,
 * the way the reference prints it): the projection's depth and weight rows (column-major `projection`) solved for the view depth, which holds
 * for the reversed, infinite-far projection (`near / z`) as for an orthographic one.
 */
export const oitSceneDepth = (projection: ArrayLike<number>, z: number) =>
  Math.abs((projection[14]! - z * projection[15]!) / (z * projection[11]! - projection[10]!)) *
  CENTIMETRES_PER_METRE
