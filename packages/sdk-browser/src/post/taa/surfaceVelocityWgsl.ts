import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { wpoGraphWgsl } from '../../visibility/shader/wpoGraphWgsl.ts'
import { SURFACE_MOTION_WGSL, VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import { PAGE_OF_WGSL } from './pageIdWgsl.ts'
import {
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
} from '../../hair/visibilityMath.ts'
import { PIXEL_ANIMATED, PIXEL_RESTARTS, TEXEL_TILE, VECTOR_FORMAT } from './velocityWgsl.ts'

/** The velocity stage's bindings: what the velocity passes read, then the vectors written. */
export const SURFACE_VELOCITY_BINDINGS = { ...VELOCITY_INPUT_BINDINGS, vectors: 10 } as const

/** The bindings of the strands' velocity entries, in group 1 (`waterVelocity` holds binding 0). */
export const HAIR_VELOCITY_BINDINGS = {
  depth: 1,
  rule: 2,
  coverage: 3,
  nodeIndex: 4,
  nodes: 5,
} as const

/**
 * THE VELOCITY STAGE: the motion of each render texel's own surface, drawn once an image before the
 * lighting for every pass that reads it — the indirect light, the depth of field, the temporal
 * pass, the motion blur — into one target, the velocity of the image: the reprojection vector of the
 * surface the texel shows (`encodeOwnVector`), one word a texel, its own motion where the surface
 * moves by itself and measures large enough (`drawsMotion`), else the camera's alone. The word says
 * which (`hasOwnMotion`); a second word holds the flags of its pixel, `PIXEL_ANIMATED` where its
 * surface animates its own pixels together with the responsiveness code its material carries
 * (`pageOf`), and its depth step (`withDepthStep`). No neighbour is read: the passes that dilate it — the temporal pass's
 * analysis (`nearestVelocityWgsl.ts`), the depth of field, the motion blur — each do it with their
 * own rule. One depth load, one identifier load and one reprojection per texel. With `wpo`, the
 * vertices of a surface whose offset is a motion are placed where the offset puts them now and
 * before (`pagePosition`, `pagePreviousPosition`). `waterVelocity` is its second entry: where the single-layer water is
 * nearer than the surface the texel shows (`group(1)`: the depth of the other of the two, the scene's before the water
 * or the water's, the nearer being the water's), the texel's vector is the camera's
 * alone at the water's depth, its flags none — the water's own velocity, which it writes where the reference's
 * water pass writes its velocity (`singleLayerWaterVelocityOutputPass`). `hairVelocity` and `hairVelocityOfSamples` are its third, one a
 * mode of `hairVelocityType`: where the strands cover the texel's pixel to `hairVisibilityWriteVelocityCoverageThreshold` (`group(1)`: the share
 * covered, the pixel's samples, the nearest strand's depth, 0 for none, reverse-Z) and are nearer than the surface the texel shows,
 * the texel's vector is the camera's alone at the depth of the nearest sample (`hairVelocity`), the mean of the samples' or the largest
 * of them (`HAIR_VELOCITY_MAX`), flagged as the pixel of a surface that moves by itself (`PIXEL_ANIMATED`: a strand's pixel is not one its
 * history follows), and, where any sample's vector is longer than `hairVelocityThreshold`, as one whose history restarts
 * (`PIXEL_RESTARTS`: the resolve is made at once, sharper and noisier, with no smear), as the reference writes its velocity and
 * its mask of fast resolve (`AddHairVelocityPass`).
 */
export const surfaceVelocityShader = (wpo: WpoSet = NO_WPO) =>
  wgslProgram(
    `@group(0) @binding(${SURFACE_VELOCITY_BINDINGS.vectors}) var vectorOut:texture_storage_2d<${VECTOR_FORMAT},write>;
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn surfaceVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let id=textureLoad(ids,p,0).r;
 let moves=drawsMotion(id);
 let motion=surfaceMotion(screenOfTexel(p),textureLoad(depth,p,0),id,moves);
 let page=pageOf(id);
 let flags=select(0u,${PIXEL_ANIMATED}u,page.animated>0.0)|page.responsive;
 textureStore(vectorOut,p,vec4u(encodeOwnVector(motion.xy,moves),withDepthStep(flags,motion.z),0u,0u));
}
@group(1) @binding(0) var waterDepth:texture_depth_2d;
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn waterVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let other=textureLoad(waterDepth,p,0);
 let own=textureLoad(depth,p,0);
 if(other==own){return;}
 textureStore(vectorOut,p,vec4u(encodeOwnVector(cameraOnlyMotion(screenOfTexel(p),max(other,own)),false),0u,0u,0u));
}
@group(1) @binding(${HAIR_VELOCITY_BINDINGS.depth}) var hairDepth:texture_2d<f32>;
struct HairVelocityRule{coverage:f32,threshold:f32}
@group(1) @binding(${HAIR_VELOCITY_BINDINGS.rule}) var<uniform> hairRule:HairVelocityRule;
@group(1) @binding(${HAIR_VELOCITY_BINDINGS.coverage}) var hairCoverage:texture_2d<f32>;
@group(1) @binding(${HAIR_VELOCITY_BINDINGS.nodeIndex}) var hairNodeIndex:texture_2d<u32>;
@group(1) @binding(${HAIR_VELOCITY_BINDINGS.nodes}) var<storage,read> hairNodes:array<u32>;
override HAIR_VELOCITY_MAX:bool=false;
struct HairSamples{sum:vec3f,peak:vec3f,count:u32,fast:bool}
fn hairSamples(p:vec2i)->HairSamples{
 var out=HairSamples(vec3f(0.0),vec3f(0.0),0u,false);
 let desc=textureLoad(hairNodeIndex,p,0).x;
 out.count=desc>>${HAIR_NODE_OFFSET_BITS}u;
 if(out.count==0u||textureLoad(hairCoverage,p,0).r<hairRule.coverage){out.count=0u;return out;}
 let screen=screenOfTexel(p);
 var peakSize=0.0;
 for(var i=0u;i<out.count;i++){
  let motion=cameraMotion(screen,bitcast<f32>(hairNodes[((desc&${HAIR_NODE_OFFSET_MASK}u)+i)*${HAIR_NODE_DATA_WORDS}u]));
  out.sum+=motion;
  let size=dot(motion,motion);
  if(size>peakSize){out.peak=motion;peakSize=size;}
  out.fast=out.fast||length(motion.xy)>hairRule.threshold;
 }
 return out;
}
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn hairVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let strand=textureLoad(hairDepth,p,0).x;
 if(!(strand>textureLoad(depth,p,0))){return;}
 let samples=hairSamples(p);
 if(samples.count==0u){return;}
 let motion=cameraMotion(screenOfTexel(p),strand);
 storeHairVelocity(p,motion,samples.fast);
}
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn hairVelocityOfSamples(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let samples=hairSamples(p);
 if(samples.count==0u){return;}
 storeHairVelocity(p,select(samples.sum/f32(samples.count),samples.peak,HAIR_VELOCITY_MAX),samples.fast);
}
fn storeHairVelocity(p:vec2i,motion:vec3f,fast:bool){
 let flags=withDepthStep(${PIXEL_ANIMATED}u,motion.z)|select(0u,${PIXEL_RESTARTS}u,fast);
 textureStore(vectorOut,p,vec4u(encodeOwnVector(motion.xy,true),flags,0u,0u));
}`,
    [PAGE_OF_WGSL, SURFACE_MOTION_WGSL, ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : [])],
  )

/** The velocity stage's program. */
export const SURFACE_VELOCITY_WGSL = surfaceVelocityShader()
