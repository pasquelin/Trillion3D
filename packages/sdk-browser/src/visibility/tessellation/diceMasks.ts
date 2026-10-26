import type { GraphRasters } from '../../materials/graph/graphRasters.ts'
import { maskSetOf } from '../../materials/graph/maskProgram.ts'
import { COLOR_SAMPLE_WGSL } from '../../materials/virtual/wgsl.ts'
import { TESS_BINDINGS } from './bindings.ts'

/**
 * THE GRAPH MASKS THE DICING HOLDS: the session's (`GraphRasters.pixelPrograms`), read at the camera's
 * footprint as the visibility rasters' (`../shader/maskSets.ts`), the clocks from the graph frame the
 * dicing binds; no blue noise, a patch's vertex being no pixel: the cut there is plain.
 */
export const diceMasks = (rasters: GraphRasters) =>
  maskSetOf(rasters.pixelPrograms, TESS_BINDINGS.frame, COLOR_SAMPLE_WGSL, 'exp2(-uni.mipBias)')
