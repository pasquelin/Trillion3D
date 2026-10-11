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
  VSM_UNIFORMS_BYTES,
} from './constants.ts'
import type { VsmLayout } from './layout.ts'
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

/** The block's three word views of a buffer at an offset, made once. */
const VIEWS = new WeakMap<
  ArrayBuffer,
  Map<number, { u: Uint32Array; i: Int32Array; f: Float32Array }>
>()
function viewsOf(out: ArrayBuffer, byteOffset: number) {
  let at = VIEWS.get(out)
  if (!at) VIEWS.set(out, (at = new Map()))
  let views = at.get(byteOffset)
  if (!views)
    at.set(
      byteOffset,
      (views = {
        u: new Uint32Array(out, byteOffset, VSM_UNIFORMS_BYTES / 4),
        i: new Int32Array(out, byteOffset, VSM_UNIFORMS_BYTES / 4),
        f: new Float32Array(out, byteOffset, VSM_UNIFORMS_BYTES / 4),
      }),
    )
  return views
}

/** Writes the whole block into `out` (at least VSM_UNIFORMS_BYTES). */
export function writeVsmUniforms(
  out: ArrayBuffer,
  layout: VsmLayout,
  frame: VsmFrameUniforms,
  byteOffset = 0,
) {
  const { u, i, f } = viewsOf(out, byteOffset)
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
  for (let m = 0; m < VSM_MIPS; m++) {
    u[20 + m] = layout.markMipOffsets[m] ?? 0
    u[28 + m] = layout.coverMipOffsets[m] ?? 0
  }
}
