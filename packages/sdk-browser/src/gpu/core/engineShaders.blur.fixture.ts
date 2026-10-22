import { classifyShader } from '../../post/effects/motionBlur/classifyWgsl.ts'
import { gatherShader, scatterShader } from '../../post/effects/motionBlur/dilateWgsl.ts'
import { filterShader } from '../../post/effects/motionBlur/filterWgsl.ts'
import { flattenShader } from '../../post/effects/motionBlur/flattenWgsl.ts'
import { filterTwoShader } from '../../post/effects/motionBlur/weighTwoWgsl.ts'

const FLATS = ['packed', 'float'] as const

/** The texts of the motion blur's passes (`../../post/effects/motionBlur/`): the gathering, the spread
 *  and the classifying for one direction and for two, and each form of the flattened motion (packed,
 *  or float for an orthographic view) with its flattening and its filters of both kinds, with the
 *  subgroup vote and without. */
export const BLUR_SHADERS = {
  MOTION_BLUR_GATHER: gatherShader(),
  MOTION_BLUR_SCATTER: scatterShader(),
  MOTION_BLUR_CLASSIFY: classifyShader(),
  MOTION_BLUR_GATHER_TWO: gatherShader(2),
  MOTION_BLUR_GATHER_TWO_DRAWN: gatherShader(2, true),
  MOTION_BLUR_CLASSIFY_TWO: classifyShader(2),
  ...Object.fromEntries(
    FLATS.flatMap((flat) => [
      [`MOTION_BLUR_FLATTEN_${flat}`, flattenShader(1, flat)],
      [`MOTION_BLUR_FLATTEN_TWO_${flat}`, flattenShader(2, flat)],
      ...[false, true].flatMap((subgroups) => [
        [`MOTION_BLUR_FILTER_${flat}_${subgroups}`, filterShader({ flat, subgroups })],
        [`MOTION_BLUR_FILTER_TWO_${flat}_${subgroups}`, filterTwoShader({ flat, subgroups })],
      ]),
    ]),
  ),
}
