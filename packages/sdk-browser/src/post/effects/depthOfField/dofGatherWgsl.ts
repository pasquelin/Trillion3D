import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { GATHER_RING_WGSL } from './dofGatherKernelWgsl.ts'
import { GROUP } from './dofLayout.ts'

/**
 * The density drivers of the kernel, one for each way the rings are gathered (`gatherAll`):
 * - constant (and the hexagonal web, and the slight out of focus' dynamic number of rings): every
 *   ring from the first, or the last for the background;
 * - the higher-density centre (the background's): the outer rings, then, while the kernel's radius
 *   shrunk by `downScale` stays above the number of rings and a closer geometry may intersect it,
 *   the kernel shrunk and the outer rings gathered again, the accumulated weight raised by the
 *   area ratio, up to three times; then the inner rings;
 * - recursive disks (the cinematic quality's background): the outer ring, then the whole disk inside
 *   it as one cluster, and each time the kernel shrinks, the outer ring again, with the borders
 *   of the layer moved with it.
 * The centre sample joins last where the rings run largest first or the density is not constant.
 */
const GATHER_DRIVERS_WGSL = wgslBlock(
  'GATHER_DRIVERS_WGSL',
  [GATHER_RING_WGSL],
  `
fn gatherConstant(first0:bool){
 var first=first0;
 for(var i=0u;i<gp.maxRings;i++){
  gatherRing(select(i,gp.maxRings-1u-i,largestFirst()),first);
  first=false;
 }
}
fn densityChanges(downScale:f32)->bool{
 let smallest=gp.radius*downScale+exp2(ks.mip);
 return gp.radius*downScale>f32(gp.maxRings)&&gp.minIntersect<smallest;
}
fn shrink(downScale:f32){
 gp.radius*=downScale;
 let factor=1.0/(downScale*downScale);
 if(!gp.fast){gatherAmend(factor);}
 fast*=factor;
 updateKernel();
}
fn gatherCenterDisk(downScale:f32){
 let lower=i32(gp.maxRings)-i32(gp.densityRings);
 var first=true;
 var ring=i32(gp.maxRings)-1;
 for(;ring>=lower;ring--){gatherRing(u32(ring),first);first=false;}
 for(var change=0u;change<gp.maxChanges;change++){
  if(!densityChanges(downScale)){break;}
  shrink(downScale);
  for(var r=i32(gp.maxRings)-1;r>=lower;r--){gatherRing(u32(r),false);}
 }
 for(;ring>=0;ring--){gatherRing(u32(ring),false);}
}
fn gatherRecursive(downScale:f32){
 acc.closeBorder=(f32(gp.rings-gp.densityRings)+0.5)*(gp.radius/(0.5+f32(gp.rings)));
 acc.farBorder=acc.closeBorder/downScale;
 gatherRing(gp.maxRings-1u,true);
 for(var change=0u;change<gp.maxChanges;change++){
  let remaining=gp.maxRings-1u;
  gatherStart(gp.maxRings-2u,false);
  for(var r=0u;r<remaining;r++){ringSamples(r);}
  gatherCenter(centreSample(),false);
  gatherEnd(false,kernelSamples(remaining));
  if(!densityChanges(downScale)){break;}
  gp.radius*=downScale;
  acc.farBorder=acc.closeBorder;
  acc.closeBorder=acc.farBorder*downScale;
  gatherAmend(1.0/(downScale*downScale));
  updateKernel();
  gatherRing(gp.maxRings-1u,false);
 }
}`,
)

/** The whole gather of an invocation (`gatherAll`): the kernel's scope made, the centre first where the
 *  rings run smallest first, the rings by the density's driver, the centre last otherwise, the fast
 *  sum normalised by the samples taken, the accumulator resolved. */
const GATHER_ALL_WGSL = wgslBlock(
  'GATHER_ALL_WGSL',
  [GATHER_DRIVERS_WGSL],
  `
fn centreIn(own:bool){
 let c=centreSample();
 if(!gp.fast){gatherCenter(c,own);}
 fast+=c.color;
}
fn gatherAll()->AccOut{
 ks.bilinear=gp.fast&&LAYER!=SLIGHT;
 updateKernel();
 fast=vec4f(0.0);
 let last=largestFirst()||gp.density!=D_CONSTANT;
 if(!last){centreIn(true);}
 let large=1.0+2.0*f32(gp.maxRings);
 let small=1.0+2.0*f32(gp.maxRings-gp.densityRings);
 if(gp.density==D_CENTER_DISK){gatherCenterDisk(small/large);}
 else if(gp.density==D_RECURSIVE){gatherRecursive(small/large);}
 else{gatherConstant(largestFirst());}
 if(last&&gp.density!=D_RECURSIVE){centreIn(true);}
 let samples=kernelSamples(gp.maxRings);
 fast*=1.0/samples;
 if(gp.fast){return emptyOutput();}
 return gatherResolve(samples);
}`,
)

/** The pixel's output as the layer writes it: the foreground its colour times its opacity and the
 *  opacity, the hole filling its colour and translucency, the background its colour and whether it
 *  holds any weight, the slight out of focus its colour and opacity; the background's occlusion — the
 *  average of the circles gathered and their variance, 1 at least — beside it where the quality asks. */
const GATHER_STORE_WGSL = wgslBlock(
  'GATHER_STORE_WGSL',
  [GATHER_ALL_WGSL],
  `
fn storeOutput(p:vec2u,o:AccOut){
 if(any(p>=view.gather.xy)){return;}
 var color=vec4f(0.0);
 var alpha=0.0;
 if(LAYER==FOREGROUND){color=o.foreground*o.foregroundAlpha;alpha=o.foregroundAlpha;}
 else if(LAYER==HOLE){color=o.hole;alpha=o.holeAlpha;}
 else if(LAYER==BACKGROUND){color=o.background;alpha=select(0.0,1.0,o.backgroundWeight>0.0);}
 else{color=vec4f(o.slight.rgb,o.slightOpacity);}
 textureStore(colorOut,p,color);
 if(LAYER!=SLIGHT){textureStore(alphaOut,p,vec4f(alpha,0.0,0.0,0.0));}
 if(QUALITY>=2u){
  var occlusion=vec2f(0.0);
  if(LAYER==BACKGROUND){
   let variance=max(0.0,o.cocAverage.y-o.cocAverage.x*o.cocAverage.x);
   occlusion=vec2f(o.cocAverage.x,max(variance,1.0));
  }
  textureStore(occlusionOut,p,vec4f(occlusion,0.0,0.0));
 }
}`,
)

/**
 * The gather of one layer (`LAYER`; `RINGS`, `QUALITY`, `BOKEH`), a workgroup of `GROUP` texels a side
 * on one tile of the circle of confusion's range: the tile says the largest circle (the kernel's
 * radius), the closest one, whether anything is to be gathered — none when the largest circle is
 * at most the slight out of focus' bound less one —, and whether the circles in it differ by less than
 * 5 % of the largest (`fast`): then the foreground and the background run the fast kernel, one
 * summed colour of the samples read bilinearly, the foreground's alpha the radius past the bound less
 * one. The pixel's two random signals are the interleaved gradient noise at its coordinate.
 */
export const dofGatherShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn gatherLayer(@builtin(global_invocation_id) gid:vec3u,@builtin(workgroup_id) wg:vec3u){
 let id=gid.xy;
 gp.rings=RINGS;
 gp.maxRings=RINGS;
 gp.viewport=(vec2f(id)+0.5)/vec2f(view.gather.xy);
 gp.centre=(vec2f(id)+0.5)/vec2f(view.tiles.zw);
 gp.random=vec2f(interleavedGradientNoise(vec2f(id),0.0),interleavedGradientNoise(vec2f(id),1.0));
 gp.fast=false;
 gp.density=D_CONSTANT;
 gp.densityRings=RINGS/2u;
 gp.maxChanges=3u;
 gp.affine=select(vec2f(0.0,1.0),vec2f(1.0,-1.0),LAYER==FOREGROUND||LAYER==BACKGROUND);
 let tile=cocTileRead(textureLoad(tileFgTexture,vec2i(wg.xy),0),textureLoad(tileBgTexture,vec2i(wg.xy),0));
 let hint=suggestFor(tile);
 gp.closest=hint.closest;
 gp.radius=hint.maxAbs;
 gp.minIntersect=hint.minIntersect;
 if(LAYER==SLIGHT){
  gp.density=D_DYNAMIC;
  gp.maxRings=u32(round(min(hint.maxAbs,DOF_SLIGHT)));
 }
 gatherClear();
 var out=emptyOutput();
 if(hint.early){
  storeOutput(id,out);
  return;
 }
 if((LAYER==FOREGROUND||LAYER==BACKGROUND)&&hint.fast){
  gp.fast=true;
  gp.density=select(D_CONSTANT,D_HEXAWEB,QUALITY==0u);
  gp.rings=select(RINGS,RINGS-1u,QUALITY==0u);
  gp.maxRings=gp.rings;
  _ = gatherAll();
  out.foreground=fast;
  out.foregroundAlpha=saturate(gp.radius-(DOF_SLIGHT-1.0));
  out.background=fast;
  out.backgroundWeight=1.0;
  out.cocAverage=vec2f(gp.radius,0.0);
 }else{
  if(LAYER==BACKGROUND){gp.density=select(D_CENTER_DISK,D_RECURSIVE,QUALITY==3u);}
  out=gatherAll();
 }
 storeOutput(id,out);
}`,
    [GATHER_STORE_WGSL, interleavedGradientNoise],
  )
