import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { ndcToUv, uvToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { HALF_MAX } from '../../../../../math/src/constants.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { DITHER_WGSL, quantizationError } from '../../taa/colorSpaceWgsl.ts'
import { CATMULL_ROM_TAPS_WGSL } from '../../taa/historyWgsl.ts'
import { NEAREST_CORNER_WGSL } from '../../taa/nearestCornerWgsl.ts'
import { VECTOR_CODEC_WGSL } from '../../taa/velocityWgsl.ts'
import { YCOCG_WGSL } from '../../taa/ycocgWgsl.ts'
import { DOF_COC_WGSL, DOF_PARAMS_WGSL } from './dofCommonWgsl.ts'
import { COC_FORMAT, COLOR_FORMAT, GROUP } from './dofLayout.ts'

/** The temporal accumulation's bindings: the setup's colour and circle of confusion, the depth, the
 *  motion of each texel (`velocity`), the history's colour and circle, its sampler, the two outputs. */
export const TEMPORAL_BINDINGS = {
  color: 2,
  coc: 3,
  depth: 4,
  vectors: 5,
  historyColor: 6,
  historyCoc: 7,
  sampler: 8,
  outColor: 9,
  outCoc: 10,
} as const

/** The reach, in depth texels, of the cross the nearest depth is looked for in, and in texels of the
 *  setup the motion is read at. */
const CROSS = 4

/**
 * WHAT THE TEMPORAL ACCUMULATION READS: its bindings, the working space of the colours (a luma-chroma
 * space at the stable quality, `HIGH`, else the colours as they are) and the reads of the setup's
 * samples (`sampleAt`), of the depth and the motion at a place of the setup (`gridTexel`, `depthAt`),
 * of the nearest surface's motion (`nearestBack`: the setup texel's depth texel and the four corners of a
 * cross `CROSS` depth texels away, the motion read `CROSS` setup texels away on that side) and of the
 * history (`pastAt`, at the rectangle it was written in: the colour by the five taps of a bicubic, the
 * circle bilinearly, held half a texel inside it). `DIVISOR` is the gather's divisor.
 */
const TEMPORAL_READS_WGSL = wgslBlock(
  'TEMPORAL_READS_WGSL',
  [
    DOF_PARAMS_WGSL,
    DOF_COC_WGSL,
    YCOCG_WGSL,
    CATMULL_ROM_TAPS_WGSL,
    VECTOR_CODEC_WGSL,
    NEAREST_CORNER_WGSL,
    ndcToUv,
  ],
  `override HIGH:bool=true;
override DIVISOR:u32=2u;
@group(0) @binding(${TEMPORAL_BINDINGS.color}) var currentColor:texture_2d<f32>;
@group(0) @binding(${TEMPORAL_BINDINGS.coc}) var currentCoc:texture_2d<f32>;
@group(0) @binding(${TEMPORAL_BINDINGS.depth}) var depthTexture:texture_depth_2d;
@group(0) @binding(${TEMPORAL_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${TEMPORAL_BINDINGS.historyColor}) var historyColor:texture_2d<f32>;
@group(0) @binding(${TEMPORAL_BINDINGS.historyCoc}) var historyCoc:texture_2d<f32>;
@group(0) @binding(${TEMPORAL_BINDINGS.sampler}) var historySampler:sampler;
@group(0) @binding(${TEMPORAL_BINDINGS.outColor}) var colorOut:texture_storage_2d<${COLOR_FORMAT},write>;
@group(0) @binding(${TEMPORAL_BINDINGS.outCoc}) var cocOut:texture_storage_2d<${COC_FORMAT},write>;
const CROSS:i32=${CROSS};
struct Sample{color:vec4f,coc:f32}
fn working(c:vec4f)->vec4f{return select(c,vec4f(toYcocg(c.rgb),c.a),HIGH);}
fn original(c:vec4f)->vec3f{return select(c.rgb,fromYcocg(c.rgb),HIGH);}
fn lumaOf(c:vec4f)->f32{return select(luma4(c.rgb),4.0*c.x,HIGH);}
fn hdrWeight(c:vec4f)->f32{return toneWeightOfLuma4(4.0*c.x*view.scatter.w);}
fn sampleAt(p:vec2i)->Sample{
 let q=clamp(p,vec2i(0),vec2i(view.gather.xy)-vec2i(1));
 return Sample(working(textureLoad(currentColor,q,0)),textureLoad(currentCoc,q,0).x);
}
fn lowest(a:Sample,b:Sample)->Sample{return Sample(min(a.color,b.color),min(a.coc,b.coc));}
fn highest(a:Sample,b:Sample)->Sample{return Sample(max(a.color,b.color),max(a.coc,b.coc));}
// The texel of the depth and the motion at a place, in texels of the setup's textures.
fn gridTexel(place:vec2f)->vec2i{
 let at=vec2i(floor(place/vec2f(view.gather.zw)*vec2f(view.image.zw)));
 return clamp(at,vec2i(0),vec2i(view.depthMap.zw));
}
fn depthAt(t:vec2i)->f32{return textureLoad(depthTexture,clamp(t,vec2i(0),vec2i(view.depthMap.zw)),0);}
fn pastAt(historyScreen:vec2f)->Sample{
 // The history's place in its images, which lie in the top-left of textures of the setup's buffer size.
 let rect=view.display.zw/f32(DIVISOR);
 let size=ceil(rect);
 let buffer=vec2f(view.pre.zw);
 let scale=rect/buffer;
 let low=0.5/buffer;let high=(size-0.5)/buffer;
 let edge=vec2f(1.0)-1.0/size;
 let coc=textureSampleLevel(historyCoc,historySampler,ndcToUv(clamp(historyScreen,-edge,edge))*scale,0.0).x;
 let color=bicubicRead(historyColor,historySampler,catmullRomTaps(clamp(ndcToUv(historyScreen)*scale,low,high),buffer,1.0/buffer),low,high);
 return Sample(working(color),coc);
}
fn nearestBack(near:vec2i)->vec2f{
 let place=vec2f(near)+0.5;
 let base=gridTexel(place);
 let d0=depthAt(base+vec2i(-CROSS,-CROSS));let d1=depthAt(base+vec2i(CROSS,-CROSS));
 let d2=depthAt(base+vec2i(-CROSS,CROSS));let d3=depthAt(base+vec2i(CROSS,CROSS));
 var at=base;
 if(max(max(d0,d1),max(d2,d3))>depthAt(base)){at=gridTexel(place+vec2f(CROSS*nearestCorner(d0,d1,d2,d3)));}
 return decodeVector(textureLoad(vectors,at,0).r);
}`,
)

/**
 * The reference's window of the input samples and its weight: `1 − 1.9 x² + 0.905 x⁴` of the squared distance
 * `x²` (in input pixels, scaled by `scale²`) to the sample, held to the range where it is positive.
 */
const SAMPLE_WINDOW_WGSL = wgslBlock(
  'SAMPLE_WINDOW_WGSL',
  [],
  `fn sampleWindow(d2:f32,scale2:f32)->f32{
 let x2=saturate(scale2*d2);
 return (0.905*x2-1.9)*x2+1.0;
}
// The window's weight of the sample at \`at\` texels from the nearest one, the pixel being \`offset\` from it.
fn windowAt(at:vec2f,offset:vec2f,scale2:f32)->f32{
 let d=at-offset;
 return sampleWindow(dot(d,d),scale2);
}`,
)

/**
 * THE TEMPORAL ACCUMULATION OF THE SETUP, which the depth of field runs before the image's own temporal
 * pass, so the blur the gather makes of it is stable from image to image, at the display's size over
 * the divisor whatever size the image is drawn at (the history keeps its resolution). Each pixel of that
 * size:
 * - takes the place of the setup's texel it falls on in the jittered image, and the nearest surface's
 *   motion around it (`nearestBack`), and reads the history where it was — a history off the screen or
 *   on a cut ignored;
 * - bounds the history's colour, opacity and circle by the minimum and maximum of the setup's five
 *   samples — the texel and its four neighbours —;
 * - then filters those five samples by `sampleWindow`, as wide as the pixel is large (`upscale`, the
 *   display's width over the image's) and wider where the history is ignored or the pixel moves
 *   (`reach` down by a tenth of its motion in setup pixels, held to the image's share of the display),
 *   normalised by their weights, and takes the window's weight at the pixel's offset as its share
 *   of the blend;
 * - blends them, the filtered image's weight the setting's (`current.x`) times that share, taken
 *   toward 0.2 by the pixel's motion (40 pixels of it, the most), at least a share of its history's luma
 *   over its difference with the image's, and toward 1 where the circle differs from the history's
 *   (`temporal.w`) — each weighed by its luma, a bright sample weighing less —, the opacity snapped to 1
 *   within a half percent, the colour rounded stochastically into the history's half floats.
 * Written into the images the next image reads as its history and the gather reads as its setup.
 */
export const dofTemporalShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn temporalSetup(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=view.pre.xy)){return;}
 let h=vec2i(gid.xy);
 let divisor=f32(DIVISOR);
 let pixels=vec2f(view.pre.xy);
 let uv=min((vec2f(h)+0.5)*(divisor/view.display.xy),(pixels-0.5*divisor)/pixels);
 let place=uv*(vec2f(view.image.xy)/divisor)+view.temporal.xy/divisor;
 let near=vec2i(floor(place));
 let offset=place-(vec2f(near)+0.5);
 let upscale=view.display.x/f32(view.image.x);
 let back=nearestBack(near);
 let velocity=length(back*pixels);
 let historyScreen=uvToNdc(uv)-back;
 let ignored=max(abs(historyScreen.x),abs(historyScreen.y))>=1.0||view.temporal.z!=0.0;
 var past=pastAt(historyScreen);
 // The setup's samples, and the box of them the history is held to.
 let n1=sampleAt(near+vec2i(0,-1));let n3=sampleAt(near+vec2i(-1,0));let n4=sampleAt(near);
 let n5=sampleAt(near+vec2i(1,0));let n7=sampleAt(near+vec2i(0,1));
 let boxLow=lowest(lowest(lowest(n1,n3),lowest(n4,n5)),n7);
 let boxHigh=highest(highest(highest(n1,n3),highest(n4,n5)),n7);
 let lumaPast=lumaOf(past.color);
 past=Sample(clamp(past.color,boxLow.color,boxHigh.color),clamp(past.coc,boxLow.coc,boxHigh.coc));
 // The window, as wide as the history lets it be.
 let reach=max(select(1.0,0.0,ignored)-velocity*upscale*0.1,1.0/upscale);
 let scale2=upscale*upscale*reach*reach;
 let w1=windowAt(vec2f(0.0,-1.0),offset,scale2);let w3=windowAt(vec2f(-1.0,0.0),offset,scale2);
 let w4=windowAt(vec2f(0.0),offset,scale2);
 let w5=windowAt(vec2f(1.0,0.0),offset,scale2);let w7=windowAt(vec2f(0.0,1.0),offset,scale2);
 let total=w1+w3+w4+w5+w7;
 let filtered=Sample((n1.color*w1+n3.color*w3+n4.color*w4+n5.color*w5+n7.color*w7)/total,n4.coc);
 let lumaFiltered=lumaOf(filtered.color);
 var blend=scale2*sampleWindow(dot(offset,offset),scale2)*view.current.x;
 blend=mix(blend,0.2,saturate(velocity/40.0));
 blend=max(blend,saturate(0.01*lumaPast/max(abs(lumaFiltered-lumaPast),1e-30)));
 let bilateral=saturate(1.0-abs(filtered.coc-past.coc)*select(1.0,1.0/abs(filtered.coc),abs(filtered.coc)>1.0));
 blend=mix(blend,1.0,(1.0-bilateral)*view.temporal.w);
 if(view.temporal.z!=0.0){blend=1.0;}
 if(ignored){past=filtered;}
 let weightPast=(1.0-blend)*hdrWeight(past.color);
 let weightNow=blend*hdrWeight(filtered.color);
 let scaleBoth=1.0/(weightPast+weightNow);
 let blended=Sample(past.color*(weightPast*scaleBoth)+filtered.color*(weightNow*scaleBoth),past.coc*(weightPast*scaleBoth)+filtered.coc*(weightNow*scaleBoth));
 var rgb=original(blended.color);
 rgb=select(min(rgb,vec3f(${wgslF32(HALF_MAX)})),vec3f(0.0),!(rgb>vec3f(0.0)));
 let alpha=select(blended.color.a,1.0,blended.color.a>0.995);
 rgb=ditherFloat(rgb,frameRandom(h,view.counts.z).x,${wgslF32(quantizationError(HDR_FORMAT))});
 textureStore(colorOut,h,vec4f(rgb,alpha));
 textureStore(cocOut,h,vec4f(select(0.0,blended.coc,blended.coc==blended.coc),0.0,0.0,0.0));
}`,
    [TEMPORAL_READS_WGSL, SAMPLE_WINDOW_WGSL, DITHER_WGSL, uvToNdc],
  )
