import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { workgroupSumLoop } from '../../../gpu/core/workgroupSumWgsl.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { GROUP } from './dofLayout.ts'
import { RECOMBINE_PAIRS, RECOMBINE_SLIGHT_WGSL } from './dofRecombineWgsl.ts'
import { layersOver } from '../../../blend/translucencyComposeWgsl.ts'

/**
 * The slight out of focus of a pixel at the full size, from the gathered radius of its tile's
 * neighbourhood: the clamping of its sums to the range of the half-size slight out of focus around
 * (`slightClamp`: a pixel whose circle is nil keeps what it gathered, one of half a texel or more is
 * held to the neighbourhood's range of colour and opacity, widened by `view.recombine.x` of it, so a
 * highlight the gather catches does not flicker) and its resolve into an unpremultiplied colour and an
 * opacity.
 */
const SLIGHT_RESOLVE_WGSL = wgslBlock(
  'SLIGHT_RESOLVE_WGSL',
  [RECOMBINE_SLIGHT_WGSL],
  `
fn slightClamp(s:ptr<function,Slight>,uv:vec2f,coc:f32){
 let invBuffer=1.0/vec2f(view.gather.zw);
 let top=(vec2f(view.gather.xy)-0.5)*invBuffer;
 var lo=vec4f(0.0);
 var hi=vec4f(0.0);
 for(var i=0u;i<4u;i++){
  let offset=vec2f(select(-0.5,0.5,(i&1u)==1u),select(-0.5,0.5,(i>>1u)==1u));
  let c=textureSampleLevel(slightColor,pointSampler,min(uv+offset*invBuffer,top),0.0);
  lo=select(min(lo,c),c,i==0u);
  hi=select(max(hi,c),c,i==0u);
 }
 let small=view.recombine.x*(1.0-saturate(coc*coc/64.0));
 hi+=lo*small;
 lo-=lo*small;
 lo.a=saturate(lo.a);
 hi.a=saturate(hi.a);
 let w=saturate(coc*coc*4.0);
 let kept=clamp((*s).color.rgb,lo.rgb*(*s).colorWeight,hi.rgb*(*s).colorWeight);
 (*s).color=vec4f(mix((*s).color.rgb,kept,w),(*s).color.a);
 (*s).opacity=mix((*s).opacity,clamp((*s).opacity,lo.a*(*s).opacityWeight,hi.a*(*s).opacityWeight),w);
}`,
)

/** How the layers lie over one another: the background, the hole filling's translucency held under what
 *  the foreground leaves, the foreground over all. */
const LAYERS_WGSL = wgslBlock(
  'LAYERS_WGSL',
  [SLIGHT_RESOLVE_WGSL, PI],
  `fn bgSampled()->bool{return HAS_BG||!HAS_FG;}
fn recombineLayers(dofUV:vec2f,centre:FullSample,bgOpacity0:f32,gathered:vec4f,fgIn:vec4f,fgTranslucency:f32)->vec4f{
 var bgOpacity=bgOpacity0;
 var background=vec4f(0.0);
 var validity=0.0;
 if(bgSampled()){
  background=textureSampleLevel(bgColor,linearSampler,dofUV,0.0);
  validity=textureSampleLevel(bgAlpha,linearSampler,dofUV,0.0).x;
  background*=safeRcp(validity);
 }
 if(QUALITY>0u){
  var hole=textureSampleLevel(holeColor,linearSampler,dofUV,0.0);
  var holeTranslucency=textureSampleLevel(holeAlpha,linearSampler,dofUV,0.0).x;
  if(validity<=0.001){
   if(holeTranslucency<1.0){
    amendTranslucency(&hole,&holeTranslucency,min(1.0-foregroundConsidered(centre.coc),validity));
   }else{bgOpacity=1.0;}
  }
  background=background*holeTranslucency+hole;
 }else if(validity<=0.001){bgOpacity=1.0;}
 var fg=fgIn;
 var translucency=fgTranslucency;
 var result=background*(1.0-bgOpacity)+bgOpacity*gathered;
 if(QUALITY==0u&&translucency<1.0&&validity!=1.0){
  amendTranslucency(&fg,&translucency,saturate(DOF_SLIGHT+centre.coc));
 }
 result=result*translucency+fg;
 return result;
}`,
)

/**
 * The recombine of one image, a workgroup of `GROUP` pixels a side (`QUALITY`, `HAS_FG`, `HAS_BG`,
 * `BOKEH`):
 * - the neighbourhood: each pixel reads the circles of four texels `6` pixels away on the diagonals
 *   and of itself, keeps the largest under the slight out of focus' bound, and the workgroup the largest
 *   of those (a reduction in workgroup memory); a workgroup with one above 1/8 of a texel does the
 *   full-size gather — a disc of that radius of sample pairs (at most 12 or 16, half the disc's
 *   area), unless the pixel lies under the foreground —;
 * - the layers: the foreground, the hole filling and the background read bilinearly at the pixel's place
 *   in the gather's textures; the background, taken as unrendered where its opacity is under a
 *   thousandth, is covered by the hole filling, whose translucency is held under what the foreground
 *   leaves of the pixel; the pixel itself, by its in-focus opacity, over the background (the full-size
 *   gather's, if it ran; the background's circle opacity where the quality has no gather);
 * - the foreground then lies over all: the image's colour times the foreground's translucency, plus its
 *   premultiplied colour — held, where there is no hole filling, under what its circle allows —; the
 *   alpha, kept in the image's own coverage, is snapped to 0 or 1 within half a percent;
 * - the translucency of the layers drawn after the depth of field then lies over the image
 *   (`layersOver`), a texel of white and nothing where the image has none: the image is composed here,
 *   not by a pass of its own.
 */
export const dofRecombineShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn recombine(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) lane:u32){
 let id=gid.xy;
 let size=vec2f(view.image.xy);
 let base=(vec2f(id)+0.5)*(size-0.5)/size;
 let texel=vec2i(floor(clamp(base,vec2f(0.0),size-0.5)));
 let buffer=vec2f(view.gather.zw);
 // The layers are stable in time where the setup is accumulated: a pixel of the jittered image reads them
 // where the jitter moved it from.
 let dofUV=min(((vec2f(id)+0.5-view.temporal.xy)/size)*(vec2f(view.gather.xy)/buffer),(vec2f(view.gather.xy)-0.5)/buffer);
 let centre=FullSample(textureLoad(sceneTexture,texel,0),fullCoc(texel),1.0);
 var reachHere=select(0.0,abs(centre.coc),abs(centre.coc)<DOF_SLIGHT);
 for(var j=0u;j<4u;j++){
  let corner=vec2f(select(-1.0,1.0,(j&1u)==1u),select(-1.0,1.0,(j>>1u)==1u));
  let at=vec2i(floor(clamp(base+corner*${2 * 3}.0,vec2f(0.0),size-0.5)));
  let reached=abs(fullCoc(at));
  reachHere=max(reachHere,select(reachHere,reached,reached<DOF_SLIGHT));
 }
 reach[lane]=reachHere;
 ${workgroupSumLoop(GROUP * GROUP, 'reach[lane]=max(reach[lane],reach[lane+stride]);')}
 let tileReach=reach[0];
 if(any(id>=view.image.xy)){return;}
 var fg=vec4f(0.0);
 var fgTranslucency=1.0;
 if(HAS_FG){
  fg=textureSampleLevel(fgColor,linearSampler,dofUV,0.0);
  fgTranslucency=1.0-textureSampleLevel(fgAlpha,linearSampler,dofUV,0.0).x;
 }
 var bgOpacity=inFocusOpacity(centre.coc);
 var gathered=centre.color;
 if(QUALITY==0u){bgOpacity=backgroundOpacity(centre.coc);}
 else if(tileReach>0.125&&fgTranslucency>=0.01){
  let radius=tileReach*2.0;
  let pairs=min(select(${RECOMBINE_PAIRS[1]}u,${RECOMBINE_PAIRS[2]}u,QUALITY==2u),u32(PI*radius*radius*0.5));
  var slight=Slight(vec4f(0.0),0.0,0.0,0.0);
  slightCentre(&slight,centre);
  let seed=rand3dPcg16(vec3i(vec2i(id),i32(view.counts.z))).xy;
  slightGather(&slight,base,ceil(radius)+0.5,pairs,seed);
  slightClamp(&slight,dofUV,centre.coc);
  let opacity=saturate(slight.opacity*safeRcp(slight.opacityWeight));
  bgOpacity=select(0.0,opacity,slight.colorWeight>0.0);
  gathered=slight.color*safeRcp(slight.colorWeight);
 }
 var shown=recombineLayers(dofUV,centre,bgOpacity,gathered,fg,fgTranslucency);
 shown.a=select(select(shown.a,1.0,shown.a>0.995),0.0,shown.a<0.005);
 let at=vec2i(id);
 let layer=textureLoad(layers,min(at,vec2i(textureDimensions(layers))-vec2i(1)),0);
 let m=textureLoad(modulation,min(at,vec2i(textureDimensions(modulation))-vec2i(1)),0);
 textureStore(sceneOut,at,layersOver(shown,layer,m));
}`,
    [LAYERS_WGSL, SLIGHT_RESOLVE_WGSL, PI, rand3dPcg16, layersOver],
  )
