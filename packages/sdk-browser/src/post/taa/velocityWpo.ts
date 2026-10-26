import type { GraphRasters } from '../../materials/graph/graphRasters.ts'
import type { WpoSet } from '../../materials/graph/wpoProgram.ts'
import { colorSampleWgsl, SHADOW_TILE_POOL_WGSL } from '../../materials/virtual/wgsl.ts'
import { VELOCITY_INPUT_BINDINGS as AT } from './nearestSurfaceWgsl.ts'
import { VELOCITY_ATLAS } from './inputs.ts'

/** The texture reads of an offset in the velocity passes: the colour atlas at no level bias, the
 *  passes having no view uniform of the visibility passes' kind. */
const VELOCITY_SAMPLE = colorSampleWgsl(SHADOW_TILE_POOL_WGSL)

/**
 * The offsets the velocity passes hold: those the session's surfaces wear (`GraphRasters.offsets`),
 * on the numbers the velocity passes bind the surfaces' records, the normal atlas, the graph frame
 * and the colour atlas at (`VELOCITY_INPUT_BINDINGS`), where they place a pixel's triangle.
 */
export const velocityWpo = (rasters: GraphRasters): WpoSet => ({
  programs: rasters.offsets,
  table: AT.material,
  normals: AT.normals,
  frame: AT.frame,
  sample: VELOCITY_SAMPLE,
  atlas: { color: VELOCITY_ATLAS, sampler: AT.sampler },
})
