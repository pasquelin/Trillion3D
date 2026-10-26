import { VIS_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import {
  colorSampleWgsl,
  COLOR_SAMPLE_WGSL,
  SHADOW_TILE_POOL_WGSL,
} from '../../materials/virtual/wgsl.ts'
import type { GraphRasters } from '../../materials/graph/graphRasters.ts'
import { maskSetOf } from '../../materials/graph/maskProgram.ts'

/**
 * THE GRAPH MASKS A MODULE HOLDS, by the kind of pass that reads them: the camera's passes — the
 * visibility rasters and the dicing — read a texture at the render pixel's footprint, the pools'
 * level offset (`uni.mipBias`) cancelled as the base map's own cutout does (`maskAlphaWgsl`); the
 * shadow passes read it on their pool at no offset. Every mask the session's surfaces wear
 * (`GraphRasters.pixelPrograms`, held from its open): a surface whose graph joins later is kept whole by a
 * module made before it. The visibility rasters and the shadow raster bind the graph frame and the
 * blue noise at the visibility layout's numbers, and so dither the cutouts that ask for it; a stage
 * that sees no blue noise (the vertex stage of the shadow tessellation) asks `dither` false.
 */
export const cameraMasks = (rasters: GraphRasters) =>
  maskSetOf(
    rasters.pixelPrograms,
    VIS_BINDINGS.frame,
    COLOR_SAMPLE_WGSL,
    'exp2(-uni.mipBias)',
    VIS_BINDINGS.noise,
  )
export const shadowMasks = (rasters: GraphRasters, dither = true) =>
  maskSetOf(
    rasters.pixelPrograms,
    VIS_BINDINGS.frame,
    colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
    '1.0',
    dither ? VIS_BINDINGS.noise : undefined,
  )
