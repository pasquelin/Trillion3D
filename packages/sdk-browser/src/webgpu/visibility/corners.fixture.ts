// The CPU oracle of a row's eight world corners, which the rows pass writes (`composeCorners`,
// `../../placement/gpuComposeDerivedWgsl.ts`): the doubles `pageCornersInto` derives, each carried
// by two single-precision values, the rounding then its residue. The word tests hold the shader to it.
import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
import { BOX_CORNER_VALUES, pageCornersInto } from '../../hiz/corners.ts'
import type { HizPage } from '../../hiz/types.ts'
import type { MatrixElements } from '../../host/matrixElements.ts'

const pageCorners = new Float64Array(BOX_CORNER_VALUES)

/**
 * The eight world corners of `page` placed by `world` and grown by `reach`, derived by `pageCornersInto`, written in `packed` from `base`.
 * Each coordinate leaves in two words: the single-precision rounding, then what it left. The sum of
 * the two represents the original double to within a squared ulp.
 */
export function packPageCorners(
  packed: Float32Array,
  base: number,
  page: HizPage,
  world: MatrixElements,
  reach = 0,
) {
  pageCornersInto(pageCorners, 0, page, world, reach)
  for (let k = 0; k < 8; k++)
    for (let axis = 0; axis < 3; axis++)
      writeSplitDouble(
        packed,
        base + k * 6 + axis,
        base + k * 6 + 3 + axis,
        pageCorners[k * 3 + axis],
      )
}
