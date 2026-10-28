import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { depthOfLogSlice, logSliceOfDepth, uvToNdc } from '../../../../math/src/wgsl/projection.ts'
import { TEXTURE_FORMATS_TIER1_WGSL } from '../../gpu/core/textureFormatsTier.ts'
import { DITHER_WGSL, quantizationErrorsOf } from '../../post/taa/colorSpaceWgsl.ts'
import { STACKED_SAMPLE_WGSL, TV_SH_WGSL } from '../translucency/frameWgsl.ts'
import { TRANSLUCENCY_GI_FRAME } from './layout.ts'

/** The frame's structure (`TranslucencyGiFrame`), which the program declares as `gi`. */
export const GI_FRAME_WGSL = wgslBlock('GI_FRAME_WGSL', [], TRANSLUCENCY_GI_FRAME.wgsl)

/**
 * THE GRID'S LAW, written once for the passes that place a cell and the surfaces that find theirs. A cell's depth slice follows the logarithm of
 * the distance (`giSliceOfDepth`, `giDepthOfSlice`, its two inverses: the library's `logSliceOfDepth`, `depthOfLogSlice` over `gi.zParams`);
 * `giCellOffset` is the place of a cell at the fraction `offset` of it along each axis, RELATIVE TO THE EYE (`giCellUv` its point of the image):
 * on the ray of the eye through that point of the image, at the depth of the slice. The ray is found with one unprojection of the point at
 * an arbitrary depth through the camera's inverse without the anti-aliasing jitter, of the view-projection set at the eye (`gi.inverse`, the
 * render frame of `camera/renderOrigin.ts`): the homogeneous result is the point over its clip `w`, so that the point at view depth `D` — the
 * view depth being the clip `w`, affine along the ray from the eye, which is the origin of that frame — is `h.xyz · D` from the eye. A pass
 * that projects the place (the history, `gi.previous`) stays in that frame; `giCellPoint` adds the eye last (`view.camera`, the camera's
 * view point: the eye of that frame; no cancellation of two large terms far from the origin) for the passes that need the world point. The
 * program declares the frame (`gi`) and the view's group (`SP_REFLECTION`) beside this block.
 */
const GI_CELL_WGSL = wgslBlock(
  'GI_CELL_WGSL',
  [GI_FRAME_WGSL, uvToNdc, logSliceOfDepth, depthOfLogSlice],
  `fn giDepthOfSlice(slice:f32)->f32{return depthOfLogSlice(slice,gi.zParams.xyz);}
fn giSliceOfDepth(depth:f32)->f32{return logSliceOfDepth(depth,gi.zParams.xyz);}
fn giCellUv(cell:vec3f,offset:vec3f)->vec2f{return (cell.xy+offset.xy)/vec2f(gi.grid.xy);}
fn giCellOffset(cell:vec3f,offset:vec3f)->vec3f{
 let h=gi.inverse*vec4f(uvToNdc(giCellUv(cell,offset)),0.5,1.0);
 return h.xyz*giDepthOfSlice(cell.z+offset.z);
}
fn giCellPoint(cell:vec3f,offset:vec3f)->vec3f{return view.camera.xyz+giCellOffset(cell,offset);}`,
)

/**
 * WHETHER A CELL IS WORTH TRACING (`giVisible`): its nearest slice's depth is nearer than the farthest the depth pyramid shows in the
 * cell's footprint (the level whose texel is two cells across, `gi.depth.z`), so a cell wholly behind the surfaces drawn is skipped; where nothing is
 * drawn the cell is seen. The farthest depth is the one of the opaque image alone, as the culling reads it. A pass lists the depth pyramid's
 * group (`SP_REFLECTION`) beside this block.
 */
export const GI_VISIBLE_WGSL = wgslBlock(
  'GI_VISIBLE_WGSL',
  [GI_CELL_WGSL],
  `fn giVisible(cell:vec3u)->bool{
 let level=min(i32(gi.depth.z),hizLevelCount()-1);
 let pixel=(vec2f(cell.xy)+vec2f(0.5))*f32(1u<<gi.grid.w);
 var z=0.0;
 if(level<=0){z=hizOpaqueDepth(vec2i(pixel));}
 else{z=hizCellCullFarthest(vec2i(floor(pixel/f32(1<<u32(level)))),level);}
 if(z<=0.0){return true;}
 return giDepthOfSlice(max(f32(cell.z)-1.0,0.0))<surfaceLinearDepth(worldAt(pixel,z));
}`,
)

/** What a program that binds a storage texture of `format` opens with: the 11-11-10 format is no core storage format (`TEXTURE_FORMATS_TIER1_WGSL`),
 *  the others are. */
export const giFormatWgsl = (format: GPUTextureFormat) =>
  format === 'rg11b10ufloat' ? [TEXTURE_FORMATS_TIER1_WGSL] : []

/**
 * A LIGHT WRITTEN TO A FLOAT FORMAT (`giQuantize`), the texture's `format`: rounded stochastically, a draw of the texel and the image's rank among
 * eight (`xy` the texel, `z` the slice or the slice and the pass: the draw's third coordinate is `z · 8 + rank`) moving it by its own step times
 * the draw, so that the format's rounding averages to the value (`ditherFloat`, the format's `2^-mantissa`). Needs `gi.temporal.z`.
 */
export const giQuantizeWgsl = (format: GPUTextureFormat) =>
  wgslBlock(
    `giQuantizeWgsl(${format})`,
    [GI_FRAME_WGSL, DITHER_WGSL],
    `fn giQuantize(c:vec3f,xy:vec2u,z:u32)->vec3f{
 let slot=z*8u+u32(gi.temporal.z)%8u;
 return ditherFloat(c,frameRandom(vec2i(xy),slot).x,${quantizationErrorsOf(format)});
}`,
  )

/**
 * THE VOLUME READ AT A POINT OF THE GRID (`giVolumeCoord`, `giSampleVolume`). The coordinate of a clip position is the image's across and the
 * slice's fraction of the grid's depth (the `slices` given, the slices' law `zParams`). The volume the surfaces, the history and the fog read
 * holds the ambient light and the directional light in the two halves of one texture (`stackedSample`). Each half is read trilinearly, the
 * depth held half a slice inside it, so that the filter never mixes the two; the result is the ambient light in the first column, the
 * directional in the second.
 */
export const GI_SAMPLE_WGSL = wgslBlock(
  'GI_SAMPLE_WGSL',
  [logSliceOfDepth, STACKED_SAMPLE_WGSL],
  `fn giVolumeCoord(clip:vec4f,zParams:vec4f,slices:f32)->vec3f{
 let ndc=clip.xy/clip.w;
 let slice=logSliceOfDepth(clip.w,zParams.xyz);
 return vec3f(ndc*vec2f(0.5,-0.5)+vec2f(0.5),slice/slices);
}
fn giSampleVolume(volume:texture_3d<f32>,smp:sampler,uvw:vec3f,slices:f32)->mat2x3f{
 return mat2x3f(stackedSample(volume,smp,uvw,slices,0.0,2.0).xyz,stackedSample(volume,smp,uvw,slices,1.0,2.0).xyz);
}`,
)

/**
 * THE LIGHT A VOLUME HOLDS, as the surfaces take it (`giIrradiance`: the ambient light in the first column, the directional in the second,
 * `tvIrradiance` of them). The integration keeps the directional light as the luminance of each linear coefficient.
 */
export const GI_LIGHT_WGSL = wgslBlock(
  'GI_LIGHT_WGSL',
  [TV_SH_WGSL],
  `fn giIrradiance(light:mat2x3f,N:vec3f,single:bool)->vec3f{return tvIrradiance(light[0],light[1],N,single);}`,
)
