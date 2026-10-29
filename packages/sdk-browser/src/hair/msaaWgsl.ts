import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { visWorkDeclaration, visWriteWgsl } from '../visibility/raster/pixelWgsl.ts'
import { HAIR_BAND_WGSL, HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { samplePlane } from './rasterWgsl.ts'
import { HAIR_RIBBON_WGSL } from './ribbonWgsl.ts'
import { hairListedPixel, hairTileQuadVs } from './tilesWgsl.ts'
import { SEGMENT_VERTICES } from './transmittanceWgsl.ts'
import {
  HAIR_ID_BITS,
  HAIR_TILE_LISTS,
  HAIR_TILE_SIZE,
  type HairSampleCount,
} from './visibilityMath.ts'

/** The samples a pixel of the hardware raster holds: the most a multisampled target of the API holds. */
export const HAIR_MSAA_SAMPLES = 4
/** The format of the target the strands' identifiers are drawn into (a format the API lets be
 *  multisampled): the identifier's low then high sixteen bits, and a word that is 1 where a strand wrote
 *  the sample (the identifier of the first strand of the first group is 0). */
export const HAIR_MSAA_VIS_FORMAT: GPUTextureFormat = 'rgba16uint'
/** How far, in pixels, the second pass of a pixel of more than four samples is moved: the four samples
 *  of each pass lie at the hardware's standard positions, and the second four lie a sixteenth of a pixel
 *  off them, so that no sample of a pixel is another's. */
export const HAIR_MSAA_SHIFT = [-1 / 16, 1 / 16] as const

/** The passes of the hardware raster a count of samples takes: one of four samples each. */
export const hairMsaaPasses = (samples: HairSampleCount) => ceilDiv(samples, HAIR_MSAA_SAMPLES)

/**
 * THE VISIBILITY OF THE STRANDS BY THE HARDWARE RASTER, the reference's default mode: every segment
 * drawn as a ribbon (`HAIR_RIBBON_WGSL`) by the hardware's rasterizer into a four-sample target, the
 * strand's identifier in each sample it covers and its depth in the sample's depth. The ribbons are
 * the software raster's (the same corners, the same least width); the hardware cuts them to the view
 * in clip space. The depth of the opaque surfaces is first written into every sample of the depth
 * target (`MSAA_FILL_WGSL`), so that a strand behind a surface fails the depth test, as one
 * in front passes it (the nearer or equal). A segment that is not drawn, or whose ends have no side,
 * is six vertices at one point. `SHIFT_X` and `SHIFT_Y` move the pass by that many pixels (`HAIR_MSAA_SHIFT`).
 */
export const MSAA_WGSL = wgslProgram(
  `@group(1) @binding(1) var sceneDepth:texture_depth_2d;
override SHIFT_X:f32=0.0;
override SHIFT_Y:f32=0.0;
struct VsOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) code:u32}
@vertex fn hairVisibilityVs(@builtin(vertex_index) vertex:u32)->VsOut{
 var result:VsOut;
 result.position=vec4f(0.0,0.0,0.0,1.0);
 result.code=0u;
 let segment=vertex/${SEGMENT_VERTICES}u;
 if(!segmentDrawn(segment)){return result;}
 let first=spineAt(segment);
 let second=spineAt(segment+1u);
 if(!first.ok||!second.ok){return result;}
 let k=vertex%${SEGMENT_VERTICES}u;
 var spine=first;
 if(cornerTip(k)){spine=second;}
 let clip=cornerClip(spine,cornerRight(k));
 result.position=vec4f(clip.xy+vec2f(SHIFT_X,-SHIFT_Y)*2.0/view.size*clip.w,clip.zw);
 result.code=(segment&${2 ** HAIR_ID_BITS - 1}u)|((inst.ids.x&${2 ** (32 - HAIR_ID_BITS) - 1}u)<<${HAIR_ID_BITS}u);
 return result;
}
@fragment fn hairVisibilityFs(@location(0) @interpolate(flat) code:u32)->@location(0) vec4u{return vec4u(code&0xffffu,code>>16u,1u,0u);}`,
  [HAIR_RIBBON_WGSL],
)

/**
 * THE OPAQUE DEPTH INTO THE SAMPLES' DEPTH, drawn over the tiles with strands alone (a quad a tile of the
 * list of all of them, the arguments the tiles' pass wrote): every sample of a pixel of those tiles takes
 * the depth of the opaque surface, so that a strand behind it fails the depth test. The tiles with none
 * are left as the clear made them; the resolve reads no other.
 */
export const MSAA_FILL_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> tiles:array<u32>;
@group(0) @binding(2) var sceneDepth:texture_depth_2d;
struct FillOut{@location(0) vis:vec4u,@builtin(frag_depth) depth:f32}
@fragment fn hairFillFs(@builtin(position) position:vec4f)->FillOut{
 return FillOut(vec4u(0u),textureLoad(sceneDepth,vec2i(position.xy),0));
}`,
  [hairTileQuadVs],
)

/**
 * THE SAMPLES OF THE HARDWARE RASTER INTO THE VISIBILITY BUFFER: for each pixel of the tiles with
 * strands, in the rows of the band, each sample of the pass (`PASS`, four of the pixel's samples each)
 * a strand wrote takes its place among the pixel's samples of the buffer the compaction reads, by the
 * visibility write the software raster uses (`visWriteWgsl`): the depth key of the sample's depth and
 * the strand's identifier. A sample no strand wrote stays what the clear left it. A thread is a
 * pixel, a group a tile of the list of all the tiles with strands.
 */
export function msaaResolveWgsl(samples: HairSampleCount, wide: boolean) {
  const planes = wide
    ? ''
    : `
  visWrite(at,key,code,true);`
  return wgslProgram(
    `const SAMPLES=${samples}u;
override PASS:u32=0u;
@group(0) @binding(1) var<storage,read> counts:array<u32,${HAIR_TILE_LISTS}>;
@group(0) @binding(2) var<storage,read> tiles:array<u32>;
${visWorkDeclaration(wide, 3, 0, 'samples')}
@group(0) @binding(4) var<uniform> band:HairBand;
@group(0) @binding(5) var msaaDepth:texture_depth_multisampled_2d;
@group(0) @binding(6) var msaaVis:texture_multisampled_2d<u32>;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairMsaaResolve(@builtin(workgroup_id) block:vec3u,@builtin(num_workgroups) blocks:vec3u,@builtin(local_invocation_id) local:vec3u){
 let found=hairListedPixel(flatIndex(block,blocks,1u),local.xy);
 let pixel=found.pixel;
 if(!found.ok||pixel.y<band.first||pixel.y>=band.end){return;}
 for(var q=0u;q<${HAIR_MSAA_SAMPLES}u;q++){
  let s=PASS*${HAIR_MSAA_SAMPLES}u+q;
  if(s>=SAMPLES){break;}
  let vis=textureLoad(msaaVis,vec2i(pixel),i32(q));
  if(vis.z==0u){continue;}
  let code=vis.x|(vis.y<<16u);
  let key=visKey(textureLoad(msaaDepth,vec2i(pixel),i32(q)),0u);
  let at=((pixel.y-band.first)*image.size.x+pixel.x)*SAMPLES+s;
  visWrite(at,key,code,false);${planes}
 }
}`,
    [
      HAIR_IMAGE_WGSL,
      HAIR_BAND_WGSL,
      hairListedPixel,
      FLAT_INDEX_WGSL,
      visWriteWgsl(wide, { buffer: 'samples', plane: samplePlane }),
    ],
  )
}
