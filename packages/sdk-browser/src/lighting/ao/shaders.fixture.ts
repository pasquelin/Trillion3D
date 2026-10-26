// Every program of the occlusion's search, by shape, for the engine's shader sweeps (`gpu/core/engineShaders.fixture.ts`):
// built where the sweeps read them, never at the session's start.
import { horizonCombineShader, horizonShapeOf } from './horizon/searchWgsl.ts'
import { HORIZON_QUALITY_SHAPES } from './horizon/tables.ts'
import { aoOcclusionShader, aoShapeKey, aoShapeOf, type AoShape } from './occlusionWgsl.ts'
import { AO_QUALITY_SHAPES } from './tables.ts'

/** Every shape a pass can be compiled for: each quality, the step with or without a coarser result, the last pass with or
 *  without, and the compute pass's, the last pass over the depth's normals with none. */
const aoShapes = (): AoShape[] =>
  AO_QUALITY_SHAPES.flatMap((_, quality) => [
    ...(['step', 'final'] as const).flatMap((kind) =>
      [false, true].map((upsample) => aoShapeOf(kind, quality, upsample)),
    ),
    aoShapeOf('final', quality, false, true),
  ])

/** The text of every program of the disc search, by shape, and of the horizon search's: each quality with the depth's normals and
 *  the surfaces' (its filters are on the list by name, `engineShaders.fixture.ts`). */
export const aoShaders = (): Record<string, string> => ({
  ...Object.fromEntries(aoShapes().map((shape) => [aoShapeKey(shape), aoOcclusionShader(shape)])),
  ...Object.fromEntries(
    HORIZON_QUALITY_SHAPES.flatMap((_, quality) =>
      [false, true].map((normals) => {
        const shape = horizonShapeOf(quality, normals)
        return [`HORIZON_${shape.key}`, horizonCombineShader(shape)]
      }),
    ),
  ),
})
