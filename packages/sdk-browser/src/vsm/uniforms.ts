/**
 * The VSM uniform block: the scalar part of the shadow map uniform parameters, filled at the
 * array initialisation and at the page marking. The textures and buffers of that block are
 * separate bindings (`resources.ts`). Appended at the end: the storage-buffer layout of the 2D
 * tables (sizes and per-mip offsets), which a texture carries implicitly and a buffer cannot.
 */
import {
  VSM_DETAIL_PIXELS_DYNAMIC,
  VSM_DETAIL_PIXELS_STATIC,
  VSM_MIPS,
  VSM_NORMAL_BIAS,
  VSM_SCREEN_RAY_SHARE,
  VSM_TRACE_VOTE_AFTER,
  VSM_TRACE_SLOPE_CAP_SUN,
  VSM_TRACE_SLOPE_CAP_LOCAL,
  VSM_TRACE_CONE_LIMIT,
  VSM_TRACE_PLANE_BIAS_CAP_LOCAL,
  VSM_TRACE_RAYS_SUN,
  VSM_TRACE_RAYS_LOCAL,
  VSM_TRACE_REACH_SUN,
  VSM_TRACE_STEPS_SUN,
  VSM_TRACE_STEPS_LOCAL,
  VSM_TRACE_DITHER_SUN,
  VSM_TRACE_DITHER_LOCAL,
  VSM_UNIFORMS_BYTES,
} from './constants.ts'
import type { VsmLayout } from './layout.ts'
import { focalScale } from '../../../math/src/projection/camera.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * The fields some shader reads, nothing else, by role: the frame's words, the pool's, the tables',
 * the marking's and the traces', then the tables' mip offsets. The struct is the layout:
 * `writeVsmUniforms` writes its words in its order.
 */
export const VSM_UNIFORMS_WGSL = wgslBlock(
  'VSM_UNIFORMS_WGSL',
  [],
  `
struct VsmUniforms{
 frameStamp:u32,
 fullMapCount:u32,
 singlePageMapCount:u32,
 pressureBias:f32,
 poolPages:u32,
 poolRowShift:u32,
 poolRowMask:u32,
 staticSlice:u32,
 poolPagesXY:vec2u,
 pageTableSize:vec2u,
 pageTableRowShift:u32,
 pageTableRowMask:u32,
 coverSize:vec2u,
 detailPixelsStatic:f32,
 detailPixelsDynamic:f32,
 normalBias:f32,
 screenRayShare:f32,
 traceVoteAfter:u32,
 traceConeCot:f32,
 traceRaysSun:i32,
 traceStepsSun:i32,
 traceSlopeCapSun:f32,
 traceDitherSun:f32,
 traceReachSun:f32,
 traceRaysLocal:i32,
 traceStepsLocal:i32,
 traceSlopeCapLocal:f32,
 traceDitherLocal:f32,
 tracePlaneBiasCapLocal:f32,
 markMipOffset:array<vec4u,2>,
 coverMipOffset:array<vec4u,2>,
}
fn vsmMarkMipOffset(mip:u32)->u32{return vsm.markMipOffset[mip>>2u][mip&3u];}
fn vsmCoverMipOffset(mip:u32)->u32{return vsm.coverMipOffset[mip>>2u][mip&3u];}
`,
)

/** Per-frame values of the block; the rest comes from the constants and the layout. */
export interface VsmFrameUniforms {
  fullMapCount: number
  singlePageMapCount: number
  frameStamp: number
  /** Fed back from the previous frames' free page count. */
  pressureBias: number
}

/** Writes the whole block into `out` (at least VSM_UNIFORMS_BYTES). */
export function writeVsmUniforms(
  out: ArrayBuffer,
  layout: VsmLayout,
  frame: VsmFrameUniforms,
  byteOffset = 0,
) {
  const u = new Uint32Array(out, byteOffset, VSM_UNIFORMS_BYTES / 4),
    i = new Int32Array(out, byteOffset, VSM_UNIFORMS_BYTES / 4),
    f = new Float32Array(out, byteOffset, VSM_UNIFORMS_BYTES / 4)
  u[0] = frame.frameStamp >>> 0
  u[1] = frame.fullMapCount
  u[2] = frame.singlePageMapCount
  f[3] = frame.pressureBias
  u[4] = layout.poolPages
  u[5] = layout.poolRowShift
  u[6] = layout.poolRowMask
  u[7] = layout.staticSlice
  u[8] = layout.poolPagesXY[0]
  u[9] = layout.poolPagesXY[1]
  u[10] = layout.pageTableSize[0]
  u[11] = layout.pageTableSize[1]
  u[12] = layout.pageTableRowShift
  u[13] = layout.pageTableRowMask
  u[14] = layout.coverSize[0]
  u[15] = layout.coverSize[1]
  f[16] = VSM_DETAIL_PIXELS_STATIC
  f[17] = VSM_DETAIL_PIXELS_DYNAMIC
  f[18] = VSM_NORMAL_BIAS
  f[19] = VSM_SCREEN_RAY_SHARE
  u[20] = VSM_TRACE_VOTE_AFTER
  f[21] = focalScale(VSM_TRACE_CONE_LIMIT)
  i[22] = VSM_TRACE_RAYS_SUN
  i[23] = VSM_TRACE_STEPS_SUN
  f[24] = VSM_TRACE_SLOPE_CAP_SUN
  f[25] = VSM_TRACE_DITHER_SUN
  f[26] = VSM_TRACE_REACH_SUN
  i[27] = VSM_TRACE_RAYS_LOCAL
  i[28] = VSM_TRACE_STEPS_LOCAL
  f[29] = VSM_TRACE_SLOPE_CAP_LOCAL
  f[30] = VSM_TRACE_DITHER_LOCAL
  f[31] = VSM_TRACE_PLANE_BIAS_CAP_LOCAL
  for (let m = 0; m < VSM_MIPS; m++) {
    u[32 + m] = layout.markMipOffsets[m] ?? 0
    u[40 + m] = layout.coverMipOffsets[m] ?? 0
  }
}
