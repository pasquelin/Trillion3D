import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { TEXTURE_FORMATS_TIER1_WGSL } from '../../gpu/core/textureFormatsTier.ts'
import { SSS_SAMPLED_WGSL } from './burleyWgsl.ts'
import { SSS_IDS_FORMAT } from './layout.ts'
import { SSS_RASTER_WGSL } from './recombineWgsl.ts'
import { SSS_SEPARABLE_WGSL } from './separableWgsl.ts'
import { SSS_SETUP_WGSL } from './setupWgsl.ts'
import { sssShapeHeader, type SubsurfaceShape } from './shape.ts'
import {
  SSS_ARGS_WGSL,
  SSS_IMAGE_KERNELS_WGSL,
  SSS_TILE_KERNELS_WGSL,
  sssComputeBindings,
} from './tileWgsl.ts'

/**
 * THE PROGRAMS OF THE SUBSURFACE PASS, as text, for a shape (`SubsurfaceShape`) on a device that stores to eight-bit integers or
 * not (`tier1`): the kernels over the image — classification, clears, mips, setup, the two scatterings — in one module (groups 0 to 2),
 * the kernels that build the arguments in another (groups 0, 2 and 3: a buffer the dispatches read is bound to none of them), the
 * draws in a third.
 */
export function sssComputeProgram(shape: SubsurfaceShape, tier1: boolean) {
  return wgslProgram(sssShapeHeader(shape), [
    ...(tier1 ? [TEXTURE_FORMATS_TIER1_WGSL] : []),
    sssComputeBindings(SSS_IDS_FORMAT(tier1)),
    SSS_TILE_KERNELS_WGSL,
    SSS_IMAGE_KERNELS_WGSL,
    SSS_SETUP_WGSL,
    SSS_SEPARABLE_WGSL,
    SSS_SAMPLED_WGSL,
  ])
}
export const sssArgsProgram = (shape: SubsurfaceShape) =>
  wgslProgram(sssShapeHeader(shape), [SSS_ARGS_WGSL])
export const sssRasterProgram = (shape: SubsurfaceShape) =>
  wgslProgram(sssShapeHeader(shape), [SSS_RASTER_WGSL])
