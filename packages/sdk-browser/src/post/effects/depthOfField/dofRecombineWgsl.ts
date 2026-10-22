import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { hammersley16, rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { DOF_COC_WGSL, DOF_PARAMS_WGSL } from './dofCommonWgsl.ts'
import { BOKEH_LUT_SIZE, COLOR_FORMAT, GROUP } from './dofLayout.ts'

/** The recombine's bindings: the image, its depth, the foreground's, the hole filling's, the slight
 *  out of focus' and the background's colour and opacity, the table, the two samplers, the output. */
export const RECOMBINE_BINDINGS = {
  scene: 1,
  depth: 2,
  fgColor: 3,
  fgAlpha: 4,
  holeColor: 5,
  holeAlpha: 6,
  slightColor: 7,
  bgColor: 8,
  bgAlpha: 9,
  lut: 10,
  linear: 11,
  point: 12,
  out: 13,
} as const

/** The recombine's quality, as the pipeline constant `QUALITY` reads it. */
export const RECOMBINE_PAIRS = [0, 12, 16] as const

/** The recombine's inputs. `HAS_FG`, `HAS_BG`: which layers were gathered. */
const RECOMBINE_INPUTS_WGSL = wgslBlock(
  'RECOMBINE_INPUTS_WGSL',
  [DOF_PARAMS_WGSL, DOF_COC_WGSL],
  `
override QUALITY:u32=2u;
override HAS_FG:bool=true;
override HAS_BG:bool=true;
override BOKEH:bool=false;
@group(0) @binding(${RECOMBINE_BINDINGS.scene}) var sceneTexture:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.depth}) var depthTexture:texture_depth_2d;
@group(0) @binding(${RECOMBINE_BINDINGS.fgColor}) var fgColor:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.fgAlpha}) var fgAlpha:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.holeColor}) var holeColor:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.holeAlpha}) var holeAlpha:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.slightColor}) var slightColor:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.bgColor}) var bgColor:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.bgAlpha}) var bgAlpha:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.lut}) var recombineLut:texture_2d<f32>;
@group(0) @binding(${RECOMBINE_BINDINGS.linear}) var linearSampler:sampler;
@group(0) @binding(${RECOMBINE_BINDINGS.point}) var pointSampler:sampler;
@group(0) @binding(${RECOMBINE_BINDINGS.out}) var sceneOut:texture_storage_2d<${COLOR_FORMAT},write>;
var<workgroup> reach:array<f32,${GROUP * GROUP}>;
// The circle of confusion of the image texel p, from the depth under it.
fn fullCoc(p:vec2i)->f32{
 let t=clamp(vec2i(floor((vec2f(p)+0.5)*view.depthMap.xy)),vec2i(0),vec2i(view.depthMap.zw));
 return cocOfDepth(sceneDepthOf(textureLoad(depthTexture,t,0)),view.basis.x);
}`,
)

/** The opacities and weights of the recombine, all functions of a circle's radius in the gather's
 *  texels: its weight (the radius' disc's inverse area, a pixel's at most), its intersection with a
 *  full-size pixel at a distance (a smooth ramp of 4 per texel), and the opacities that fade the
 *  foreground, the in-focus and the background layers into one another. */
const RECOMBINE_WEIGHTS_WGSL = wgslBlock(
  'RECOMBINE_WEIGHTS_WGSL',
  [RECOMBINE_INPUTS_WGSL, PI],
  `
fn recombineWeight(coc:f32)->f32{
 let pixel=0.25;
 return min(1.0/max(4.0*PI*coc*coc,1e-30),1.0/(4.0*PI*pixel*pixel));
}
fn recombineIntersection(coc:f32,dist:f32)->f32{
 let ramp=saturate((max(abs(coc),0.25)-dist)*4.0+0.5);
 return smoothstep(0.0,1.0,ramp);
}
fn backgroundOpacity(coc:f32)->f32{return saturate(DOF_SLIGHT-coc);}
fn inFocusOpacity(coc:f32)->f32{return saturate(2.0-4.0*abs(coc));}
fn foregroundOpacity(coc:f32)->f32{return saturate(-1.0-8.0*coc);}
fn foregroundConsidered(coc:f32)->f32{return foregroundOpacity(coc)*saturate(DOF_SLIGHT+coc);}
fn amendTranslucency(color:ptr<function,vec4f>,translucency:ptr<function,f32>,most:f32){
 if(*translucency<1.0){
  let held=min(*translucency,most);
  *color=*color*((1.0-held)/(1.0-*translucency));
  *translucency=held;
 }
}`,
)

/**
 * The slight out of focus at the full size: the sums of a pixel's colour and opacity over a Hammersley
 * disc of sample pairs (`pairs`, up to 12 or 16) of the radius the neighbourhood asks, each sample
 * its colour and circle — the circle from the depth — weighed by its weight, its intersection with the
 * pixel (the diaphragm's table where the bokeh is on) and how far it is considered; of a mirrored
 * pair the one in front gives its intersection and weight to the one behind. The centre is
 * always considered. `Slight` holds the sums; `slightResolve` the unpremultiplied colour and the
 * opacity, 0 where nothing was weighed.
 */
export const RECOMBINE_SLIGHT_WGSL = wgslBlock(
  'RECOMBINE_SLIGHT_WGSL',
  [RECOMBINE_WEIGHTS_WGSL, hammersley16, rand3dPcg16],
  `
struct Slight{color:vec4f,colorWeight:f32,opacity:f32,opacityWeight:f32}
struct FullSample{color:vec4f,coc:f32,inter:f32}
fn slightAdd(s:ptr<function,Slight>,a:FullSample,weight:f32,considered:f32){
 let colored=a.inter*weight*considered;
 (*s).color+=a.color*colored;
 (*s).colorWeight+=colored;
 (*s).opacity+=a.inter*backgroundOpacity(a.coc);
 (*s).opacityWeight+=a.inter;
}
fn slightCentre(s:ptr<function,Slight>,c:FullSample){slightAdd(s,c,recombineWeight(c.coc),1.0);}
fn slightPair(s:ptr<function,Slight>,a0:FullSample,b0:FullSample){
 var a=a0;
 var b=b0;
 var wa=recombineWeight(a.coc);
 var wb=recombineWeight(b.coc);
 if(b.coc>a.coc){b.inter=a.inter;wb=wa;}
 else if(a.coc>b.coc){a.inter=b.inter;wa=wb;}
 slightAdd(s,a,wa,saturate(DOF_SLIGHT-abs(a.coc)));
 slightAdd(s,b,wb,saturate(DOF_SLIGHT-abs(b.coc)));
}
fn fullSampleAt(t:vec2f)->FullSample{
 let p=vec2i(floor(clamp(t,vec2f(0.0),vec2f(view.image.xy)-0.5)));
 return FullSample(textureLoad(sceneTexture,p,0),fullCoc(p),1.0);
}
fn samplePair(s:ptr<function,Slight>,base:vec2f,offset0:vec2f){
 var offset=offset0;
 if(!BOKEH){offset=sign(offset)*floor(abs(offset)+0.5);}
 var dist=0.5*length(offset);
 var pair:array<FullSample,2>;
 for(var k=0u;k<2u;k++){
  let side=select(1.0,-1.0,k==1u);
  let scaled=offset*vec2f(view.lens.y,1.0);
  if(BOKEH){
   let uv=(0.5+0.5/${BOKEH_LUT_SIZE}.0)+scaled*(side/${BOKEH_LUT_SIZE}.0);
   dist=textureSampleLevel(recombineLut,pointSampler,uv,0.0).x;
  }
  var a=fullSampleAt(base+side*scaled);
  a.inter=recombineIntersection(a.coc,dist);
  if(!HAS_FG){a.coc=max(a.coc,0.0);}
  pair[k]=a;
 }
 slightPair(s,pair[0],pair[1]);
}
fn approxDisk(e:vec2f)->vec2f{
 var sf=e*sqrt(2.0)-sqrt(0.5);
 let sq=sf*sf;
 let root=sqrt(2.0*max(sq.x,sq.y)-min(sq.x,sq.y));
 if(sq.x>sq.y){sf.x=select(-root,root,sf.x>0.0);}else{sf.y=select(-root,root,sf.y>0.0);}
 return sf;
}
fn slightGather(s:ptr<function,Slight>,base:vec2f,radius:f32,pairs:u32,seed:vec2u){
 for(var i=0u;i<pairs;i++){
  let e=hammersley16(i,select(${RECOMBINE_PAIRS[1]}u,${RECOMBINE_PAIRS[2]}u,QUALITY==2u),seed);
  samplePair(s,base,radius*approxDisk(e));
 }
}`,
)
