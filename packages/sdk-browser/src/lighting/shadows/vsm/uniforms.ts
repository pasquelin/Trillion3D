/**
 * The VSM uniform block: the scalar part of the shadow map uniform parameters, filled at the
 * array initialisation and at the page marking. The textures and buffers of that block are
 * separate bindings (`resources.ts`). Appended at the end: the storage-buffer layout of the 2D
 * tables (sizes and per-mip offsets), which a texture carries implicitly and a buffer cannot.
 */
import { VSM_MIPS } from './constants.ts'
import { DOF_BIAS_RAMP_PIXELS, type VsmDofBias } from './dofBias.ts'
import type { VsmLayout } from './layout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'

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
 mapCount:u32,
 pressureBias:f32,
 poolPages:u32,
 poolRowShift:u32,
 poolRowMask:u32,
 staticSlice:u32,
 includeInCoarsePages:u32,
 pageTableSize:vec2u,
 coverSize:vec2u,
 detailPixelsStatic:f32,
 detailPixelsDynamicClusters:f32,
 normalBias:f32,
 screenRayLength:f32,
 markMipOffset:array<vec4u,2>,
 coverMipOffset:array<vec4u,2>,
 pageKeepFrames:u32,
 adaptiveRayCount:u32,
 traceConeCot:f32,
 traceReachSun:f32,
 traceSlopeCapLocal:f32,
 traceSlopeCapSun:f32,
 tracePlaneBiasCap:f32,
 traceDitherLocal:f32,
 traceDitherSun:f32,
 mipModeLocal:u32,
 deferredBudget:i32,
 lodDeltaInvalidates:u32,
 dofStrength:f32,
 dofInfinity:f32,
 dofMinForeground:f32,
 dofMaxBackground:f32,
 dofFocus:f32,
 dofBlurExponent:f32,
 dofBlurRadius:f32,
 dofWidth:f32,
 hzbStaticLayer:u32,
 subsurfaceMinSourceRadius:f32,
 onePassMaxLights:u32,
 cullBackfacing:u32,
}
/** The resolution bias the depth of field asks at a view depth (\`dofBias.ts\`): the circle of
 *  confusion's radius there — the model's, or the depth blur's, the larger, held between the
 *  foreground's and the background's largest — in pixels, over eight of the strength, never above it. */
fn vsmDofResolutionBias(sceneDepth:f32)->f32{
 if(vsm.dofStrength==0.0){return 0.0;}
 let radius=((sceneDepth-vsm.dofFocus)/sceneDepth)*vsm.dofInfinity;
 let blur=(1.0-exp2(-sceneDepth*vsm.dofBlurExponent))*vsm.dofBlurRadius;
 let coc=clamp(max(abs(radius),blur)*sign(radius),vsm.dofMinForeground,vsm.dofMaxBackground);
 return min(vsm.dofStrength,mix(0.0,vsm.dofStrength,abs(coc)*vsm.dofWidth/${DOF_BIAS_RAMP_PIXELS}.0));
}
fn vsmMarkMipOffset(mip:u32)->u32{return vsm.markMipOffset[mip>>2u][mip&3u];}
fn vsmCoverMipOffset(mip:u32)->u32{return vsm.coverMipOffset[mip>>2u][mip&3u];}
`,
)

/** Per-frame values of the block; the rest comes from the constants and the layout. */
export interface VsmFrameUniforms {
  /** The frame's maps: ids [0, mapCount). */
  mapCount: number
  frameStamp: number
  /** Fed back from the previous frames' free page count. */
  pressureBias: number
  /** The pixel footprints under which an object stays out of the coarse pages, by its layer. */
  detailPixelsStatic: number
  detailPixelsDynamicClusters: number
  /** Whether the casters may be drawn into the coarse pages (`shadowCoarsePagesIncludeNonClusterCasters`): false
   *  puts every caster in them, whatever its footprint, the thresholds read by none. */
  includeInCoarsePages: boolean
  /** The receiver's normal offset per distance to the eye, and the screen ray's share of the view's height. */
  normalBias: number
  screenRayLength: number
  /** The frames a page that no pixel asks for stays kept. */
  pageKeepFrames: number
  /** The traces' settings: the ray after which an umbra stops a group (0 never), the cotangent of the
   *  angle a local ray may lean off its light, a sun ray's reach, the steepest slopes the march
   *  extends an occluder with (local, sun), the largest receiver-plane bias of a local ray, and the
   *  start dither's scale (local, sun). */
  adaptiveRayCount: number
  traceConeCot: number
  traceReachSun: number
  traceSlopeCapLocal: number
  traceSlopeCapSun: number
  tracePlaneBiasCap: number
  traceDitherLocal: number
  traceDitherSun: number
  /** Which mips a local light's pixels mark: 0 all, 1 the even ones, 2 the odd ones. */
  mipModeLocal: number
  /** The deferred invalidations carried out a frame (-1 all, 0 none), and whether a cluster drawn
   *  coarser than asked, for want of its finer level, invalidates its pages. */
  deferredBudget: number
  lodDeltaInvalidates: number
  /** The depth of field's bias on the maps' resolution (`dofBias.ts`). */
  dof: VsmDofBias
  /** The sine of half the smallest angle a sun's disk takes on a subsurface receiver
   *  (`shadowSubsurfaceMinSourceAngle`). */
  subsurfaceMinSourceRadius: number
  /** The most local lights a pixel's mask holds (`shadowOnePassProjectionMaxLightsPerPixel`). */
  onePassMaxLights: number
  /** Whether the projection culls the pixels facing away from a light (`shadowCullBackfacingPixels`). */
  cullBackfacing: boolean
}

/** Writes the whole block into `out` (at least VSM_UNIFORMS_BYTES). */
export function writeVsmUniforms(
  out: ArrayBuffer,
  layout: VsmLayout,
  frame: VsmFrameUniforms,
  byteOffset = 0,
) {
  const { u, f } = wordViews(out, byteOffset)
  u[0] = frame.frameStamp >>> 0
  u[1] = frame.mapCount
  f[2] = frame.pressureBias
  u[3] = layout.poolPages
  u[4] = layout.poolRowShift
  u[5] = layout.poolRowMask
  u[6] = layout.cacheEnabled ? 1 : 0
  // Word 7 sits before pageTableSize, a vec2u at an 8-byte boundary.
  u[7] = frame.includeInCoarsePages ? 1 : 0
  u[8] = layout.pageTableSize[0]
  u[9] = layout.pageTableSize[1]
  u[10] = layout.coverSize[0]
  u[11] = layout.coverSize[1]
  f[12] = frame.detailPixelsStatic
  f[13] = frame.detailPixelsDynamicClusters
  f[14] = frame.normalBias
  f[15] = frame.screenRayLength
  // markMipOffset is an array at a 16-byte boundary, which word 16 is.
  for (let m = 0; m < VSM_MIPS; m++) {
    u[16 + m] = layout.markMipOffsets[m] ?? 0
    u[24 + m] = layout.coverMipOffsets[m] ?? 0
  }
  u[32] = frame.pageKeepFrames
  u[33] = frame.adaptiveRayCount
  f[34] = frame.traceConeCot
  f[35] = frame.traceReachSun
  f[36] = frame.traceSlopeCapLocal
  f[37] = frame.traceSlopeCapSun
  f[38] = frame.tracePlaneBiasCap
  f[39] = frame.traceDitherLocal
  f[40] = frame.traceDitherSun
  u[41] = frame.mipModeLocal
  u[42] = frame.deferredBudget | 0
  u[43] = frame.lodDeltaInvalidates
  f[44] = frame.dof.strength
  f[45] = frame.dof.infinityRadius
  f[46] = frame.dof.minForeground
  f[47] = frame.dof.maxBackground
  f[48] = frame.dof.focusDistance
  f[49] = frame.dof.blurExponent
  f[50] = frame.dof.blurRadius
  f[51] = frame.dof.width
  u[52] = layout.hzbStaticLayer
  f[53] = frame.subsurfaceMinSourceRadius
  u[54] = frame.onePassMaxLights
  u[55] = frame.cullBackfacing ? 1 : 0
}
