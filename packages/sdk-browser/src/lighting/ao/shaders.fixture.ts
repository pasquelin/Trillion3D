// Every program of the occlusion's search, by shape, for the engine's shader sweeps (`gpu/core/engineShaders.fixture.ts`):
// built where the sweeps read them, never at the session's start.
import { aoOcclusionShader, aoShapeKey, aoShapeOf, type AoShape } from './occlusionWgsl.ts'
import { AO_QUALITY_SHAPES } from './tables.ts'

/** Every shape a pass can be compiled for: each quality, the step with or without a coarser result, the last pass with or without. */
export const aoShapes = (): AoShape[] =>
  AO_QUALITY_SHAPES.flatMap((_, quality) =>
    (['step', 'final'] as const).flatMap((kind) =>
      [false, true].map((upsample) => aoShapeOf(kind, quality, upsample)),
    ),
  )

/** The text of every program of the search, by shape. */
export const aoShaders = (): Record<string, string> =>
  Object.fromEntries(aoShapes().map((shape) => [aoShapeKey(shape), aoOcclusionShader(shape)]))
