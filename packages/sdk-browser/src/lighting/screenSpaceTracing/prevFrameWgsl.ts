import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import {
  SCREEN_SPACE_BINDINGS,
  SCREEN_SPACE_INPUTS_WGSL,
  SCREEN_SPACE_CAST_WGSL,
  SCREEN_SPACE_REPROJECT_WGSL,
} from './rayCastWgsl.ts'
import { VECTOR_CODEC_WGSL } from '../../post/taa/velocityWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE, SCREEN_SPACE_GROUP_THREADS } from './screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from './screenSpaceView.ts'

/** The bindings the reduction adds to the group (the last image's colour is color): the depth the last image kept, the level of the chain
 *  the second pass reads, and the three levels it writes after the two the first writes (out, outSecond). */
export const PREV_FRAME_BINDINGS = { prevDepth: 13, higher: 14, outThird: 15 } as const
const P = PREV_FRAME_BINDINGS
const B = SCREEN_SPACE_BINDINGS

/**
 * THE LAST LIT IMAGE, REDUCED TO A CHAIN OF FIVE LEVELS FOR THE INDIRECT LIGHT, leak-free: no light of a surface leaks onto a surface
 * of another depth. The first pass (reduceFirst) takes each pixel's colour from where the last image stood (the camera's motion, or the pixel's
 * own vector), weights it by how near the world point the last depth puts there lies to the pixel's own (within a hundred pixels' radius
 * at the pixel's depth), zeroes the sky past the sky distance, corrects the exposure, fades it at the borders of both images, and
 * averages it by groups of 2 by 2 and 4 by 4 into the chain's first two levels (alpha the sum of the weights). The second pass (reduceLower)
 * reduces the second level with the furthest depth of the pyramid into the last three. The chain is rgba16f, the alpha in the colour's fourth
 * channel (one texture and not two, as the storage textures of a stage are four) and the workgroup memory holds floats, not halves.
 * A pass reads its neighbours' results only past a barrier: the reference's reads and writes of one level overlap in the same memory.
 */
const REDUCTION_COMMON = `
var<workgroup> reducedColor:array<vec4f,${SCREEN_SPACE_GROUP_THREADS}>;
var<workgroup> reducedDepth:array<f32,${SCREEN_SPACE_GROUP_THREADS}>;
struct Reduced{color:vec4f,depth:f32,}
fn reductionClean(color:vec4f)->vec4f{return -min(-color,vec4f(0.0));}
fn reductionRadius(depth:f32)->f32{
 let radius=ssPixelRadius(depth)*100.0;
 return 1.0/(radius*radius);
}
`

/** The first pass's pixel colour: the last image's colour at pixel, corrected, weighted and faded. */
const FIRST_PIXEL = `
fn reductionFirstColor(pixel:vec2u)->Reduced{
 let min_=vec2f(0.5)*ssView.size.zw;
 let uv=clamp((vec2f(pixel)+vec2f(0.5))*ssView.size.zw,min_,vec2f(1.0)-min_);
 let screen=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);
 let deviceZ=hizOpaqueDepth(vec2i(floor(uv*ssView.size.xy)));
 let depth=ssSceneDepth(deviceZ);
 let thisClip=vec4f(screen,deviceZ,1.0);
 let prevClip=ssView.clipToPrevClip*thisClip;
 var prevScreen=prevClip.xy/prevClip.w;
 let isSky=depth>ssView.sky.x&&ssView.sky.x>0.0;
 let vectorSize=vec2i(textureDimensions(colorVectors));
 let words=textureLoad(colorVectors,clampToExtent(vec2i(floor(uv*vec2f(vectorSize))),vectorSize),0);
 if(hasOwnMotion(words.r)){prevScreen=thisClip.xy-decodeVector(words.r);}
 let frameUV=prevScreen*ssView.previous.xy+ssView.previous.zw;
 let colorSize=vec2f(textureDimensions(colorImage));
 let edge=vec2f(0.5)/colorSize;
 let sampleUV=clamp(frameUV,edge,vec2f(1.0)-edge);
 let depthSize=vec2i(textureDimensions(prevDepth));
 let sampleTexel=clampToExtent(vec2i(floor(sampleUV*vec2f(depthSize))),depthSize);
 let prevDeviceZ=textureLoad(prevDepth,sampleTexel,0).r;
 let prevWorld=ssView.prevClipToWorld*vec4f(prevScreen,prevDeviceZ,1.0);
 let referenceWorld=ssWorldAt(screen,deviceZ);
 let d=referenceWorld-prevWorld.xyz/prevWorld.w;
 let weight=saturate(1.0-dot(d,d)*reductionRadius(depth));
 let rgb=textureLoad(colorImage,vec2i(floor(sampleUV*colorSize)),0).rgb;
 var color=reductionClean(vec4f(rgb*weight,weight));
 if(isSky){color=vec4f(0.0);}
 color=vec4f(color.rgb*ssView.sky.y,color.a);
 color=color*min(ssVignette(screen),ssVignette(prevScreen));
 return Reduced(color,depth);
}`

/** The second pass's pixel colour: four samples of the level above, weighted by how near their furthest depth lies. */
const LOWER_PIXEL = `
fn reductionLowerColor(pixel:vec2u)->Reduced{
 let factor=4.0;
 let uv=clamp(factor*(2.0*vec2f(pixel)+vec2f(1.0))*ssView.size.zw,vec2f(0.5)*ssView.size.zw,vec2f(1.0)-vec2f(0.5)*ssView.size.zw);
 let depth=ssSceneDepth(ssFurthest(uv,2.0));
 let invSquare=reductionRadius(depth);
 let higherSize=vec2f(textureDimensions(higherLevel));
 var color=vec4f(0.0);
 for(var i=0u;i<4u;i++){
  let offset=vec2f(f32(i%2u),f32(i/2u))-vec2f(0.5);
  let hzbUV=uv+offset*factor*ssView.size.zw;
  let sampleDepth=ssSceneDepth(ssFurthest(hzbUV,1.0));
  let d=depth-sampleDepth;
  let weight=0.25*saturate(1.0-d*d*invSquare);
  let texelUV=factor*(2.0*vec2f(pixel)+vec2f(1.0)+offset)*0.5*(0.5/higherSize);
  let sampleUV=min(texelUV,ssView.reducedLimit.xy);
  color+=textureLoad(higherLevel,vec2i(floor(sampleUV*higherSize)),0)*weight;
 }
 return Reduced(color,depth);
}`

/** The reduction of the 8 by 8 group's colours, 2 by 2 and 4 by 4 (past barriers), each level handed to storeLevel. */
const REDUCE_LEVELS = `
fn reduceGroup(index:u32,group:vec2u,color:vec4f,depth:f32,first:u32){
 reducedColor[index]=color;
 reducedDepth[index]=depth;
 workgroupBarrier();
 for(var mip=1u;mip<3u;mip++){
  let reduction=1u<<mip;
  let count=${SCREEN_SPACE_GROUP_THREADS}u/(reduction*reduction);
  let side=8u/reduction;
  let lane=index<count;
  let at=vec2u(index%side,index/side);
  var result=vec4f(0.0);
  var furthest=0.0;
  if(lane){
   furthest=-3.4e38;
   for(var k=0u;k<4u;k++){
    let coord=at*2u+vec2u(k%2u,k/2u);
    furthest=max(furthest,reducedDepth[coord.x+coord.y*(16u/reduction)]);
   }
   let invSquare=reductionRadius(furthest);
   for(var k=0u;k<4u;k++){
    let coord=at*2u+vec2u(k%2u,k/2u);
    let li=coord.x+coord.y*(16u/reduction);
    let d=furthest-reducedDepth[li];
    result+=reducedColor[li]*saturate(1.0-d*d*invSquare);
   }
   result=result*0.25;
  }
  workgroupBarrier();
  if(lane){
   reducedColor[index]=result;
   reducedDepth[index]=furthest;
   storeLevel(first+mip-1u,group*side+at,result);
  }
  workgroupBarrier();
 }
}`

/** The first pass's program. reduceFirst is run over the view's pixels, 8 by 8 a group; it writes the chain's levels 0 and 1. */
export const prevFrameFirstWgsl = () =>
  wgslProgram(
    `@group(${SCREEN_SPACE_GROUP}) @binding(${P.prevDepth}) var prevDepth:texture_2d<f32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.out}) var levelA:texture_storage_2d<rgba16float,write>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.outSecond}) var levelB:texture_storage_2d<rgba16float,write>;
${REDUCTION_COMMON}${FIRST_PIXEL}
fn storeLevel(level:u32,at:vec2u,color:vec4f){
 if(level==0u){textureStore(levelA,vec2i(at),color);}
 else{textureStore(levelB,vec2i(at),color);}
}
${REDUCE_LEVELS}
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn reduceFirst(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) index:u32){
 let first=reductionFirstColor(id.xy);
 reduceGroup(index,group.xy,first.color,first.depth,0u);
}`,
    [SCREEN_SPACE_INPUTS_WGSL, SCREEN_SPACE_REPROJECT_WGSL, VECTOR_CODEC_WGSL],
  )

/** The second pass's program: reduceLower reduces level 1 into levels 2 to 4; it writes level 2 itself and hands 3 and 4 to storeLevel. */
export const prevFrameLowerWgsl = () =>
  wgslProgram(
    `@group(${SCREEN_SPACE_GROUP}) @binding(${P.higher}) var higherLevel:texture_2d<f32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.out}) var levelA:texture_storage_2d<rgba16float,write>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.outSecond}) var levelB:texture_storage_2d<rgba16float,write>;
@group(${SCREEN_SPACE_GROUP}) @binding(${P.outThird}) var levelC:texture_storage_2d<rgba16float,write>;
${REDUCTION_COMMON}${LOWER_PIXEL}
fn storeLevel(level:u32,at:vec2u,color:vec4f){
 if(level==1u){textureStore(levelB,vec2i(at),color);}
 else{textureStore(levelC,vec2i(at),color);}
}
${REDUCE_LEVELS}
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn reduceLower(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) index:u32){
 let lower=reductionLowerColor(id.xy);
 textureStore(levelA,vec2i(id.xy),lower.color);
 reduceGroup(index,group.xy,lower.color,lower.depth,1u);
}`,
    [SCREEN_SPACE_INPUTS_WGSL, SCREEN_SPACE_CAST_WGSL(true)],
  )
