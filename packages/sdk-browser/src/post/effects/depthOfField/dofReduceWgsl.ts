import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import {
  DOF_COC_WGSL,
  DOF_DOWNSAMPLE_WGSL,
  DOF_PARAMS_WGSL,
  DOF_STEP_WGSL,
} from './dofCommonWgsl.ts'
import {
  COC_FORMAT,
  COLOR_FORMAT,
  DRAW_ARGUMENT_WORDS,
  GROUP,
  SCATTER_GROUP_STRIDE,
} from './dofLayout.ts'
import { DOF_VIGNETTE_WGSL } from './dofVignetteWgsl.ts'

/** The reduction's bindings: the colour and circle of confusion read, the quarter-size colour the
 *  scatter compares against, the two levels written, the draw's arguments and the two sprite lists. */
export const REDUCE_BINDINGS = {
  color: 2,
  coc: 3,
  quarter: 4,
  outColorA: 5,
  outCocA: 6,
  outColorB: 7,
  outCocB: 8,
  arguments: 9,
  foregroundList: 10,
  backgroundList: 11,
} as const

/** The reduction's inputs, outputs and workgroup memory. */
const REDUCE_INPUTS_WGSL = wgslBlock(
  'REDUCE_INPUTS_WGSL',
  [DOF_PARAMS_WGSL, DOF_STEP_WGSL, DOF_COC_WGSL, DOF_DOWNSAMPLE_WGSL],
  `
override FIRST:bool=true;
override REDUCTIONS:u32=1u;
override SCATTER_FG:bool=false;
override SCATTER_BG:bool=false;
@group(0) @binding(${REDUCE_BINDINGS.color}) var colorIn:texture_2d<f32>;
@group(0) @binding(${REDUCE_BINDINGS.coc}) var cocIn:texture_2d<f32>;
@group(0) @binding(${REDUCE_BINDINGS.quarter}) var quarterIn:texture_2d<f32>;
@group(0) @binding(${REDUCE_BINDINGS.outColorA}) var colorA:texture_storage_2d<${COLOR_FORMAT},write>;
@group(0) @binding(${REDUCE_BINDINGS.outCocA}) var cocA:texture_storage_2d<${COC_FORMAT},write>;
@group(0) @binding(${REDUCE_BINDINGS.outColorB}) var colorB:texture_storage_2d<${COLOR_FORMAT},write>;
@group(0) @binding(${REDUCE_BINDINGS.outCocB}) var cocB:texture_storage_2d<${COC_FORMAT},write>;
@group(0) @binding(${REDUCE_BINDINGS.arguments}) var<storage,read_write> drawArguments:array<atomic<u32>>;
@group(0) @binding(${REDUCE_BINDINGS.foregroundList}) var<storage,read_write> foregroundList:array<vec4u>;
@group(0) @binding(${REDUCE_BINDINGS.backgroundList}) var<storage,read_write> backgroundList:array<vec4u>;
var<workgroup> cacheColor:array<vec4f,64>;
var<workgroup> cacheCoc:array<f32,64>;
var<workgroup> maskForeground:atomic<u32>;
var<workgroup> maskBackground:atomic<u32>;
var<workgroup> baseForeground:u32;
var<workgroup> baseBackground:u32;
// The texel of a tile a lane reduces: lanes grouped by four so that each reduction reads a 2 x 2 block.
fn reduceTexel(i:u32)->vec2u{
 return vec2u(((i&1u)<<2u)|((i&4u)>>1u)|((i>>4u)&1u),((i&2u)<<1u)|((i&8u)>>2u)|((i>>5u)&1u));
}
fn writeLevel(level:u32,p:vec2u,color:vec4f,coc:f32){
 let slot=select(level-1u,level,FIRST);
 if(slot==0u){textureStore(colorA,p,color);textureStore(cocA,p,vec4f(coc,0.0,0.0,0.0));}
 else{textureStore(colorB,p,color);textureStore(cocB,p,vec4f(coc,0.0,0.0,0.0));}
}`,
)

/**
 * The decision to scatter a texel, a sprite of its colour and circle instead of a gather:
 * - `lumaFactor`: how far the texel's perceived brightness — its luma times the exposure — is past 0.1;
 * - `neighbourFactor`: how far its colour, held to the most a neighbour is compared at
 *   (`view.scatter.y`), exceeds each of four neighbours in the quarter-size copy: the brightest
 *   excess over the colour a neighbour would show;
 * - `distinction`: the weight a texel that is not scattered keeps in the gather, down to 0 for a large
 *   circle of a bright texel, past the limit (`view.scatter.z`; 1 where there is none).
 */
const SCATTER_FACTORS_WGSL = wgslBlock(
  'SCATTER_FACTORS_WGSL',
  [REDUCE_INPUTS_WGSL],
  `
fn lumaFactor(color:vec4f)->f32{return saturate(view.scatter.w*luma4(color.rgb)/0.4-1.0);}
fn neighbourFactor(texel:vec2u,color:vec4f)->f32{
 let maxColor=view.scatter.y/view.scatter.w;
 let held=min(color,vec4f(maxColor));
 let place=(vec2f(texel)+0.5)*dofStep.a.xy;
 var factor=0.0;
 for(var i=0u;i<4u;i++){
  let offset=vec2f(select(-1.0,1.0,(i&1u)==1u),select(-1.0,1.0,(i>>1u)==1u));
  let at=vec2i(clamp(floor(place+offset),vec2f(0.0),dofStep.a.zw));
  let other=min(textureLoad(quarterIn,at,0),vec4f(maxColor));
  let excess=max(held-other,vec4f(0.0));
  let major=max(max(excess.r,excess.g),excess.b)*view.scatter.w;
  factor=select(max(factor,saturate(major/0.7-1.0)),saturate(major/0.7-1.0),i==0u);
 }
 return factor;
}
fn distinction(coc:f32,color:vec4f)->f32{
 if(view.scatter.z==0.0){return 1.0;}
 let t=saturate((view.scatter.z+200.0-abs(coc)*luma4(color.rgb))/400.0);
 return t*t*(3.0-2.0*t);
}`,
)

/** The sprite a scattering texel writes into its list: group `index`'s centre when the texel is its
 *  group's first, then the texel's colour with its radius and, with a barrel, its vignette data. */
const SPRITE_WRITES_WGSL = wgslBlock(
  'SPRITE_WRITES_WGSL',
  [SCATTER_FACTORS_WGSL, DOF_VIGNETTE_WGSL],
  `
fn spriteEntries(index:u32,lane:u32,texel:vec2u,color:vec3f,coc:f32,list:u32){
 let base=index*${SCATTER_GROUP_STRIDE}u;
 let at=base+1u+lane*3u;
 let colored=bitcast<vec4u>(vec4f(color,abs(coc)));
 if(list==0u){
  if(lane==0u){foregroundList[base]=bitcast<vec4u>(vec4f(vec2f(texel)+0.5,0.0,0.0));}
  foregroundList[at]=colored;
  if(view.barrel.y>=0.0){let v=vignetteData(texel,coc);foregroundList[at+1u]=v[0];foregroundList[at+2u]=v[1];}
 }else{
  if(lane==0u){backgroundList[base]=bitcast<vec4u>(vec4f(vec2f(texel)+0.5,0.0,0.0));}
  backgroundList[at]=colored;
  if(view.barrel.y>=0.0){let v=vignetteData(texel,coc);backgroundList[at+1u]=v[0];backgroundList[at+2u]=v[1];}
 }
}`,
)

/**
 * The scattering of one texel, which returns the colour left for the gather:
 * - the factor, from the brightness, the circle's size — in the gather's texels (`circleRatio`) — past
 *   the least scattered (the layer's sign when only one scatters), the distance to the setup's edge the
 *   circle must fit in, the neighbours where the texel is already a candidate, then sharpened
 *   (`2 f − 1`);
 * - a texel above 0.01 scatters; each 2 × 2 block (a lane's `lane & 15`) that has any scattering texel
 *   gets a place in its layer's list — the workgroup's first lane counting them into the draw's
 *   instance counter —, where each of its four texels writes its colour times the factor and the
 *   intensity a circle spreads (`1 / π r²`, held to 1, `r` in the setup's texels) — 0 for the other
 *   layer's sign — if the list has room, else the texel is not scattered;
 * - what was scattered is taken out of the gather's colour; a texel that was not has its weight
 *   lowered by the distinction filter.
 */
const SCATTER_PASS_WGSL = wgslBlock(
  'SCATTER_PASS_WGSL',
  [SPRITE_WRITES_WGSL, PI],
  `
fn scatterFactor(texel:vec2u,color:vec4f,coc:f32)->f32{
 var factor=lumaFactor(color);
 if(SCATTER_FG&&!SCATTER_BG){factor*=saturate(-coc-view.scatter.x);}
 else if(!SCATTER_FG&&SCATTER_BG){factor*=saturate(coc-view.scatter.x);}
 else{factor*=saturate(abs(coc)-view.scatter.x);}
 let at=vec2f(texel)+0.5;
 let size=vec2f(dofStep.b.zw);
 factor*=saturate(min(min(at.x,at.y),min(size.x-at.x,size.y-at.y))-abs(coc));
 if(factor>0.5){factor*=neighbourFactor(texel,color);}
 return saturate(factor*2.0-1.0);
}
fn scatterPass(texel:vec2u,lane:u32,input:vec4f,coc:f32)->vec4f{
 var color=input;
 let radius=coc*circleRatio();
 var factor=scatterFactor(texel,color,radius);
 let scatters=factor>0.01;
 let foreground=isForeground(coc);
 if(!scatters){color*=distinction(coc,color);}
 let bit=1u<<(lane&15u);
 if(SCATTER_FG&&foreground&&scatters){atomicOr(&maskForeground,bit);}
 if(SCATTER_BG&&!foreground&&scatters){atomicOr(&maskBackground,bit);}
 workgroupBarrier();
 let masks=vec2u(atomicLoad(&maskForeground),atomicLoad(&maskBackground));
 if(lane==0u){
  if(SCATTER_FG&&masks.x!=0u){baseForeground=atomicAdd(&drawArguments[1u],countOneBits(masks.x));}
  if(SCATTER_BG&&masks.y!=0u){baseBackground=atomicAdd(&drawArguments[1u+${DRAW_ARGUMENT_WORDS}u],countOneBits(masks.y));}
 }
 workgroupBarrier();
 let loss=min(1.0,select(1.0,1.0/(PI*coc*coc),coc!=0.0)*view.lens.x);
 let amount=color.rgb*(factor*loss);
 if(SCATTER_FG&&(bit&masks.x)!=0u){
  let index=baseForeground+countOneBits(masks.x&(bit-1u));
  if(index<view.counts.x){spriteEntries(index,lane>>4u,texel,select(vec3f(0.0),amount,foreground),radius,0u);}
  else{factor=0.0;}
 }
 if(SCATTER_BG&&(bit&masks.y)!=0u){
  let index=baseBackground+countOneBits(masks.y&(bit-1u));
  if(index<view.counts.x){spriteEntries(index,lane>>4u,texel,select(amount,vec3f(0.0),foreground),radius,1u);}
  else{factor=0.0;}
 }
 return vec4f(color.rgb*(1.0-factor),color.a);
}`,
)

/**
 * The reduction of the setup: a workgroup of 8 × 8 texels (`GROUP`) in the order that groups them by
 * four, each lane reading its texel — a texel past the input's edge reads the edge's; `FIRST`: the
 * setup itself, where scattering takes place (`SCATTER_FG`, `SCATTER_BG`) and the texel is written as
 * the level's own; else a mip level of the reduced setup. Then `REDUCTIONS` rounds, each downsampling
 * every four lanes of the last to one (`dofDownsample`, the circle's first-smaller operator, the
 * weights' scale halved with each level) and writing the result one level up, as the two outputs
 * (`REDUCTIONS` at most 2 beyond the first level written) hold.
 */
export const dofReduceShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn reduceLevels(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&maskForeground,0u);atomicStore(&maskBackground,0u);}
 workgroupBarrier();
 let texel=vec2u(${GROUP}u)*wg.xy+reduceTexel(lane);
 let source=vec2i(min(texel,dofStep.b.xy));
 var color=textureLoad(colorIn,source,0);
 let coc=textureLoad(cocIn,source,0).x;
 if(SCATTER_FG||SCATTER_BG){color=scatterPass(texel,lane,color,coc);}
 var pixel=texel;
 if(FIRST){writeLevel(0u,pixel,color,coc);}
 cacheColor[lane]=color;
 cacheCoc[lane]=coc;
 for(var level=1u;level<=REDUCTIONS;level++){
  let bank=(${GROUP}u>>level)*(${GROUP}u>>level);
  workgroupBarrier();
  var down=Down(vec4f(0.0),0.0);
  if(lane<bank){
   var colors:array<vec4f,4>;
   var cocs=vec4f(0.0);
   for(var i=0u;i<4u;i++){
    colors[i]=cacheColor[lane+i*bank];
    cocs[i]=cacheCoc[lane+i*bank];
   }
   down=dofDownsample(colors,cocs,0.5/f32(1u<<(level-1u)),false);
  }
  workgroupBarrier();
  if(lane<bank){
   cacheColor[lane]=down.color;
   cacheCoc[lane]=down.coc;
   pixel=pixel>>vec2u(1u);
   writeLevel(level,pixel,down.color,down.coc);
  }
 }
}`,
    [SCATTER_PASS_WGSL],
  )
