/**
 * THE ROOTS' BOXES FOR THE DEPTH TEST ON THE GPU (`hzbOcclusion.ts`): one thread a root, its world box as the roots pass holds it in doubles
 * (`../../placement/roots/rootBoxesWgsl.ts`) grown as the settings ask, its eight corners written in the form the transparent occlusion test reads
 * (`CORNER_VALUES`: each coordinate the single rounding then its residue), so that the test of the depth pyramid is the one the transparent clusters
 * make. A root that is never rejected — it has no box, lies outside the view, or within the distance within which none is tested — takes zero corners
 * and its bit in `unculled`.
 *
 *   params    uniform        the roots, the image, the frames of the growth of a root newly tested, the eye in doubles, the growths and the view-projection
 *                            at the render origin
 *   rootBoxes array<vec2u>   `ROOT_BOX_DOUBLES` a root, the world box first
 *   corners   array<u32>     `CORNER_VALUES` a root
 *   unculled  array<atomic>  a bit a root, cleared before the pass
 *   history   array<u32>     two words a root: the image it was last in view, the images it is still grown for as a newly tested one
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { FLOAT32_MAX } from '../../../../math/src/wgsl/constants.ts'
import { dAdd, dSub, splitDouble } from '../../../../math/src/wgsl/double.ts'
import { doubleAsSingle, fromF32 } from '../../../../math/src/wgsl/f32.ts'
import { CORNER_VALUES } from '../../gpu/core/boxProjectWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { ROOT_BOX_DOUBLES } from '../../placement/roots/rootWorldSends.ts'

/** The pass's entry point. */
export const HZB_CORNERS_ENTRY = 'hzbRootCorners'
/** Bytes of the uniform: four `vec4`s of words and floats, two of growths, the matrix. */
export const HZB_PARAMS_BYTES = 6 * 16 + 64

export const HZB_CORNERS_WGSL = wgslProgram(
  `struct HzbParams{
 counts:vec4u,
 eyeXY:vec4u,
 eyeZ:vec4u,
 reach:vec4f,
 screenAll:vec4f,
 screenNewly:vec4f,
 viewProj:mat4x4f,
}
@group(0) @binding(0) var<uniform> params:HzbParams;
@group(0) @binding(1) var<storage,read> rootBoxes:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> corners:array<u32>;
@group(0) @binding(3) var<storage,read_write> unculled:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> history:array<u32>;
${wgslConsts({ ROOT_BOX_DOUBLES, CORNER_VALUES })}
fn hzbNeverRejected(rank:u32){
 let at=rank*CORNER_VALUES;
 for(var k=0u;k<CORNER_VALUES;k++){corners[at+k]=0u;}
 atomicOr(&unculled[rank>>5u],1u<<(rank&31u));
}
/** Whether a box (low and high corners at the render origin) is in the view or may be: one that has a corner at or behind the eye's plane is. */
fn hzbInView(low:vec3f,high:vec3f)->bool{
 var common=0x3fu;
 for(var k=0u;k<8u;k++){
  let p=select(low,high,vec3<bool>((k&1u)!=0u,(k&2u)!=0u,(k&4u)!=0u));
  let q=params.viewProj*vec4f(p,1.0);
  if(q.w<=0.0){return true;}
  var code=0u;
  if(q.x<-q.w){code|=1u;}
  if(q.x>q.w){code|=2u;}
  if(q.y<-q.w){code|=4u;}
  if(q.y>q.w){code|=8u;}
  if(q.z<0.0){code|=16u;}
  if(q.z>q.w){code|=32u;}
  common&=code;
 }
 return common==0u;
}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${HZB_CORNERS_ENTRY}(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let rank=flatIndex(g,n,WORKGROUP_THREADS);
 if(rank>=params.counts.x){return;}
 let o=rank*ROOT_BOX_DOUBLES;
 if(o+ROOT_BOX_DOUBLES>arrayLength(&rootBoxes)){hzbNeverRejected(rank);return;}
 var low:array<vec2u,3>;
 var high:array<vec2u,3>;
 var boxed=false;
 for(var a=0u;a<3u;a++){
  low[a]=rootBoxes[o+a];
  high[a]=rootBoxes[o+3u+a];
  boxed=boxed||(low[a].x|low[a].y|high[a].x|high[a].y)!=0u;
 }
 let eye=array<vec2u,3>(vec2u(params.eyeXY.x,params.eyeXY.y),vec2u(params.eyeXY.z,params.eyeXY.w),vec2u(params.eyeZ.x,params.eyeZ.y));
 let rl=vec3f(doubleAsSingle(dSub(low[0],eye[0])),doubleAsSingle(dSub(low[1],eye[1])),doubleAsSingle(dSub(low[2],eye[2])));
 let rh=vec3f(doubleAsSingle(dSub(high[0],eye[0])),doubleAsSingle(dSub(high[1],eye[1])),doubleAsSingle(dSub(high[2],eye[2])));
 if(!(boxed&&all(rh>=rl)&&all(abs(rl)<vec3f(FLOAT32_MAX))&&all(abs(rh)<vec3f(FLOAT32_MAX)))){hzbNeverRejected(rank);return;}
 // A root outside the view is not tested, nor counted among those tested lately.
 if(!hzbInView(rl,rh)){hzbNeverRejected(rank);return;}
 // A root not tested for a while is grown by the newly tested amounts for a few images.
 var newly=false;
 if(params.counts.z>0u&&params.counts.w>0u){
  var cooldown=history[rank*2u+1u];
  if(cooldown==0u&&params.counts.y-history[rank*2u]>params.counts.z){cooldown=params.counts.w;}
  newly=cooldown!=0u;
  if(newly){cooldown--;}
  history[rank*2u+1u]=cooldown;
 }
 history[rank*2u]=params.counts.y;
 let centre=(rl+rh)*0.5;
 // Within the distance none is tested at, the root is never rejected.
 if(dot(centre,centre)<params.reach.x){hzbNeverRejected(rank);return;}
 // The box grown by the world amounts, then by the pixels' worth of the world at its depth (the clip w of its centre).
 let w=(params.viewProj*vec4f(centre,1.0)).w;
 let growth=vec3f(params.reach.y+select(0.0,params.reach.z,newly))+abs(select(params.screenAll.xyz,params.screenNewly.xyz,newly)*w);
 if(any(growth>vec3f(0.0))){
  for(var a=0u;a<3u;a++){
   let extra=fromF32(bitcast<u32>(growth[a]));
   low[a]=dSub(low[a],extra);
   high[a]=dAdd(high[a],extra);
  }
 }
 let at=rank*CORNER_VALUES;
 for(var k=0u;k<8u;k++){
  for(var a=0u;a<3u;a++){
   let s=splitDouble(select(low[a],high[a],((k>>a)&1u)!=0u));
   corners[at+k*6u+a]=s.x;
   corners[at+k*6u+3u+a]=s.y;
  }
 }
}`,
  [
    FLOAT32_MAX,
    dAdd,
    dSub,
    splitDouble,
    doubleAsSingle,
    fromF32,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ],
)
