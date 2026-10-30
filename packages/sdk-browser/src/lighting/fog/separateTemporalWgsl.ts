import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { ndcToUv, uvToNdc } from '../../../../math/src/wgsl/projection.ts'
import { HALF_MAX } from '../../../../math/src/constants.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { DITHER_WGSL, quantizationErrorsOf } from '../../post/taa/colorSpaceWgsl.ts'
import { CATMULL_ROM_TAPS_WGSL } from '../../post/taa/historyWgsl.ts'
import { YCOCG_WGSL } from '../../post/taa/ycocgWgsl.ts'
import { TEXTURE_FORMATS_TIER1_WGSL } from '../../gpu/core/textureFormatsTier.ts'
import { PIXEL_FLAGS_WGSL } from '../../post/taa/velocityWgsl.ts'

/**
 * THE TEMPORAL FILTER OF THE FOG TEXTURE'S SECOND LEVEL (`separateTemporal.ts`): the temporal
 * anti-aliasing of the colour texture's first level, without the input filter, whose output feeds the
 * blur chain at its second level and is kept as the history of the next image.
 */

/** The filter's uniform: the clip positions of this image in the last image's (the camera's motion),
 *  the rect drawn of the colour texture, its extent `xy` and its reciprocal `zw`, the extent the history
 *  is allocated at `xy` and the rect the last image drew in it `zw`, the weight of the new image `x`, the
 *  exposure the image is shown at `y`, the history's pre-exposure correction `z` and whether it is
 *  dropped (a camera cut) `w`, and the image's slot among eight `x` of `frame`. */
export const TEMPORAL_LAYOUT = fieldLayout('FogTemporal', [
  ['clipToPrevClip', 'mat4x4f'],
  ['size', 'vec4f'],
  ['history', 'vec4f'],
  ['params', 'vec4f'],
  ['frame', 'vec4u'],
] as const)

/** The filter's bindings: the uniform, the colour texture's first level, the scene depth, the vectors
 *  (the flags of the surface in green), the history, its sampler, the history written and the second
 *  level written. */
export const TEMPORAL_BINDINGS = {
  uniform: 0,
  colour: 1,
  depth: 2,
  vectors: 3,
  history: 4,
  sampler: 5,
  historyOut: 6,
  levelOut: 7,
} as const
/** The filter's entry point. */
export const TEMPORAL_ENTRY = 'fogTemporalMain'
/** Texels a thread group covers along each axis (even: the second level averages 2 by 2 of them). */
export const TEMPORAL_GROUP = 8

/** The reach, in pixels, of the cross the nearest depth is looked for in. */
const CROSS = 2
/** The weight of the new image the motion pushes the blend toward, and the motion (pixels) that reaches it. */
const MOVING_BLEND = 0.2
const MOVING_PIXELS = 40
/** The share of the new image a responsive pixel takes. */
const RESPONSIVE_BLEND = 0.25
/** The share of its luma over its difference with the image's a pixel keeps at least of the new image. */
const LEAST_SHARE = 0.01

const B = TEMPORAL_BINDINGS

/** The filter's program for a history stored in `format` (the quantization of its channels follows it). */
export const fogTemporalWgsl = (format: GPUTextureFormat) =>
  wgslProgram(
    `${TEMPORAL_LAYOUT.wgsl}
@group(0) @binding(${B.uniform}) var<uniform> taa:FogTemporal;
@group(0) @binding(${B.colour}) var colour:texture_2d<f32>;
@group(0) @binding(${B.depth}) var depthTexture:texture_depth_2d;
@group(0) @binding(${B.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${B.history}) var history:texture_2d<f32>;
@group(0) @binding(${B.sampler}) var historySampler:sampler;
@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${format},write>;
@group(0) @binding(${B.levelOut}) var levelOut:texture_storage_2d<${HDR_FORMAT},write>;
const CROSS:i32=${CROSS};
var<workgroup> groupColours:array<vec4f,${TEMPORAL_GROUP * TEMPORAL_GROUP}>;

// The input colour of a texel, held inside the image, in the luma-chroma space.
fn inputAt(p:vec2i)->vec3f{
 return toYcocg(textureLoad(colour,clamp(p,vec2i(0),vec2i(taa.size.xy)-vec2i(1)),0).rgb);
}
// The alpha of the input at a texel (the clouds' transmittance), which the filter leaves as it is: the second level averages it unfiltered.
fn alphaAt(p:vec2i)->f32{
 return textureLoad(colour,clamp(p,vec2i(0),vec2i(taa.size.xy)-vec2i(1)),0).a;
}
fn depthAt(p:vec2i)->f32{
 return textureLoad(depthTexture,clamp(p,vec2i(0),vec2i(taa.size.xy)-vec2i(1)),0);
}
// The tone weight of a colour in the luma-chroma space: the luma over four, scaled to the exposure shown.
fn toneWeightOf(c:vec3f)->f32{return 1.0/(4.0*c.x*taa.params.y+4.0);}

@compute @workgroup_size(${TEMPORAL_GROUP},${TEMPORAL_GROUP},1)
fn ${TEMPORAL_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) lid:vec3u){
 let p=vec2i(id.xy);
 let uv=(vec2f(p)+0.5)*taa.size.zw;
 let screen=uvToNdc(uv);
 // The motion of the pixel: the camera's, from the nearest depth of the cross around it.
 let corners=max(max(depthAt(p+vec2i(-CROSS,-CROSS)),depthAt(p+vec2i(CROSS,-CROSS))),max(depthAt(p+vec2i(-CROSS,CROSS)),depthAt(p+vec2i(CROSS,CROSS))));
 let prevClip=taa.clipToPrevClip*vec4f(screen,max(corners,depthAt(p)),1.0);
 let back=screen-prevClip.xy/prevClip.w;
 let velocity=length(back*taa.size.xy);
 let past=screen-back;
 let cut=taa.params.w!=0.0;
 let ignored=cut||max(abs(past.x),abs(past.y))>=1.0;
 // The input at the pixel, and the box of it and its four neighbours the history is held to.
 let centre=inputAt(p);
 let n1=inputAt(p+vec2i(0,-1));let n3=inputAt(p+vec2i(-1,0));
 let n5=inputAt(p+vec2i(1,0));let n7=inputAt(p+vec2i(0,1));
 let boxLow=min(min(min(n1,n3),min(centre,n5)),n7);
 let boxHigh=max(max(max(n1,n3),max(centre,n5)),n7);
 // The history, read by the bicubic five taps held half a texel inside the rect the last image drew in it.
 let allocated=taa.history.xy;
 let before=taa.history.zw;
 let lowBefore=0.5/before;
 let uvBefore=clamp(ndcToUv(past),lowBefore,vec2f(1.0)-lowBefore);
 let taps=catmullRomTaps(uvBefore*before/allocated,allocated,1.0/allocated);
 let pastRead=bicubicRead(history,historySampler,taps,0.5/allocated,(before-vec2f(0.5))/allocated).rgb*taa.params.z;
 let pastColour=toYcocg(pastRead);
 let lumaPast=4.0*pastColour.x;
 var kept=clamp(pastColour,boxLow,boxHigh);
 // The share of the new image: the setting's, toward a fixed share by the motion, at least a share of the
 // history's luma over its difference with the image's, a responsive pixel's and a cut's.
 let flags=textureLoad(vectors,clamp(p,vec2i(0),vec2i(textureDimensions(vectors))-vec2i(1)),0).g;
 var blend=mix(taa.params.x,${wgslF32(MOVING_BLEND)},saturate(velocity/${wgslF32(MOVING_PIXELS)}));
 blend=max(blend,saturate(${wgslF32(LEAST_SHARE)}*lumaPast/max(abs(4.0*centre.x-lumaPast),1e-30)));
 if(pixelResponsive(flags)){blend=${wgslF32(RESPONSIVE_BLEND)};}
 if(cut){blend=1.0;}
 if(ignored){kept=centre;}
 // The blend, each side weighed by its luma, a bright one weighing less.
 let weightPast=(1.0-blend)*toneWeightOf(kept);
 let weightNow=blend*toneWeightOf(centre);
 let blended=(kept*weightPast+centre*weightNow)/(weightPast+weightNow);
 var rgb=fromYcocg(blended);
 rgb=select(rgb,vec3f(0.0),!(rgb>vec3f(0.0)));
 // The second level is the average of the 2 by 2 pixels of the group, as the pass writes them, the alpha as the input holds it.
 let own=lid.x+lid.y*${TEMPORAL_GROUP}u;
 groupColours[own]=vec4f(rgb,alphaAt(p));
 workgroupBarrier();
 if(((lid.x|lid.y)&1u)==0u){
  let sum=groupColours[own]+groupColours[own+1u]+groupColours[own+${TEMPORAL_GROUP}u]+groupColours[own+${TEMPORAL_GROUP + 1}u];
  textureStore(levelOut,vec2i(id.xy/2u),sum*0.25);
 }
 if(all(id.xy<vec2u(taa.size.xy))){
  let stored=min(rgb,vec3f(${wgslF32(HALF_MAX)}));
  textureStore(historyOut,p,vec4f(ditherFloat(stored,frameRandom(p,taa.frame.x).x,${quantizationErrorsOf(format)}),0.0));
 }
}`,
    [
      ...(format === 'rg11b10ufloat' ? [TEXTURE_FORMATS_TIER1_WGSL] : []),
      YCOCG_WGSL,
      PIXEL_FLAGS_WGSL,
      CATMULL_ROM_TAPS_WGSL,
      DITHER_WGSL,
      uvToNdc,
      ndcToUv,
    ],
  )
