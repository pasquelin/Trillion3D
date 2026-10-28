import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { vsmViewDepthOfDeviceZ } from '../shadows/vsm/projection/projectionDataWgsl.ts'
import { BEND_WAVE } from './bendDispatches.ts'
import { hitCastsContactShadow } from './contactShadowWgsl.ts'

/** The samples a pixel's shadow is made of, the first `BEND_HARD` of which can shadow alone and the last `BEND_FADE` of which fade out. */
const BEND_SAMPLES = 60
const BEND_HARD = 4
const BEND_FADE = 8
/** The depths each thread reads: one more wavefront than the samples span, and one for the start. */
const READS = Math.trunc(BEND_SAMPLES / BEND_WAVE) + 2

/**
 * THE KERNEL'S UNIFORM, one a dispatch: `light` the light's coordinate (`BendDispatchList.light`); `wave` the wavefront offset of the dispatch
 * (x, y, pixels) and the depth's size; `tune` the surface thickness (a share of the depth left to the far plane) in `x`; `intensity` the casting
 * and non-casting intensities of the light, the depth where the fade begins (metres) and the reciprocal of its length; `depthWords` the
 * words that turn a device depth into a view depth (`vsmWriteDepthFromDeviceZ`).
 */
export const BEND_PARAMS = fieldLayout('BendParams', [
  ['light', 'vec4f'],
  ['wave', 'vec4i'],
  ['tune', 'vec4f'],
  ['intensity', 'vec4f'],
  ['depthWords', 'vec4f'],
] as const)

/** The edge threshold and the shadow's contrast, the reference's constants of its screen-space shadow (a pixel's depth is bilinear unless it
 *  differs from its neighbour's by more than 2 % of the depth left; the shadow's value is stretched four times about full light). */
const BEND_EDGE_THRESHOLD = 0.02
const BEND_CONTRAST = 4

export const BEND_ENTRY = 'bendShadow'
/** The kernel's bindings, group 0. */
export const BEND_BINDING = { params: 0, depth: 1, flags: 2, output: 3 } as const
/** The format of the shadow the kernel writes: 1 where lit, less where shadowed (a core storage format). */
export const BEND_OUTPUT_FORMAT: GPUTextureFormat = 'r32float'

const SHADOW_BLOCK = wgslBlock(
  'BEND_SHADOW_WGSL',
  [vsmViewDepthOfDeviceZ, hitCastsContactShadow],
  `
override INTENSITY_MODE:u32=0u;
${BEND_PARAMS.wgsl}
@group(0) @binding(${BEND_BINDING.params}) var<uniform> bend:BendParams;
@group(0) @binding(${BEND_BINDING.depth}) var bendDepth:texture_depth_2d;
@group(0) @binding(${BEND_BINDING.flags}) var bendFlags:texture_2d_array<u32>;
@group(0) @binding(${BEND_BINDING.output}) var bendOut:texture_storage_2d<${BEND_OUTPUT_FORMAT},write>;
var<workgroup> bendDepths:array<f32,${READS * BEND_WAVE}>;

/** The depth at a pixel, the far plane (0, reverse depth) off the image: what the reference's border sampler answers. */
fn bendDepthAt(p:vec2i)->f32{
 if(any(p<vec2i(0))||any(p>=bend.wave.zw)){return 0.0;}
 return textureLoad(bendDepth,p,0);
}
struct BendWave{delta:vec2f,xy:vec2f,along:f32,xMajor:bool}
/** The pixel of thread \`lane\` of the wavefront of group \`group\`, and the step to the next along the ray: the wavefront lies on a ring
 *  about the light's pixel, its pixels spaced along the line to it by the larger of their two offsets. */
fn bendWave(group:vec3u,lane:u32)->BendWave{
 var xy=vec2i(group.yz)*${BEND_WAVE}+bend.wave.xy;
 let lightPixel=floor(bend.light.xy)+0.5;
 let fraction=bend.light.xy-lightPixel;
 let reverse=bend.light.w>0.0;
 let s=sign(xy);
 let horizontal=abs(xy.x+s.y)<abs(xy.y-s.x);
 let axis=select(vec2i(0,-s.x),vec2i(s.y,0),horizontal);
 xy=axis*i32(group.x)+xy;
 let xyf=vec2f(xy);
 let xMajor=abs(xyf.x)>abs(xyf.y);
 let major=select(xyf.y,xyf.x,xMajor);
 let start=abs(major);
 let end=start-${BEND_WAVE}.0;
 var fractionMajor=select(fraction.y,fraction.x,xMajor);
 fractionMajor=select(fractionMajor,-fractionMajor,major>0.0);
 let startXY=xyf+lightPixel;
 let endXY=mix(bend.light.xy,startXY,(end+fractionMajor)/(start+fractionMajor));
 let stepIndex=f32(lane^select(${BEND_WAVE - 1}u,0u,reverse));
 return BendWave(startXY-endXY,mix(startXY,endXY,stepIndex/${BEND_WAVE}.0),start-stepIndex+fractionMajor,xMajor);
}
@compute @workgroup_size(${BEND_WAVE})
fn ${BEND_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let wave=bendWave(group,lane);
 let direction=-bend.light.w;
 let trackHit=INTENSITY_MODE==0u;
 var sampling:array<f32,${READS}>;
 var shadowing:array<f32,${READS}>;
 var thickness:array<f32,${READS}>;
 var along:array<f32,${READS}>;
 var pixel=wave.xy;
 let startXY=pixel;
 let writeXY=vec2i(floor(pixel));
 for(var i=0;i<${READS};i++){
  // Two reads of the depth a pixel, the second one pixel to the side of the ray across it: they are mixed unless an edge lies between.
  let read=vec2i(floor(pixel));
  let minor=select(pixel.x,pixel.y,wave.xMajor);
  let side=select(-1,1,fract(minor)-0.5>0.0);
  let offset=select(vec2i(side,0),vec2i(0,side),wave.xMajor);
  let near=bendDepthAt(read);
  let across=bendDepthAt(read+offset);
  thickness[i]=abs(near);
  let edge=abs(near-across)>thickness[i]*${BEND_EDGE_THRESHOLD};
  sampling[i]=near;
  // The shadow casts from this depth, or from the farther one the neighbour may pull this sample toward.
  shadowing[i]=select(near+abs(near-across)*-1.0,near,edge);
  along[i]=wave.along+f32(${BEND_WAVE}*i)*direction;
  pixel+=wave.delta*direction;
 }
 for(var i=0;i<${READS};i++){
  // In this space all the light's rays are parallel: depths are taken over the distance to the light's pixel.
  var stored=(shadowing[i]-bend.light.z)/along[i];
  // A sample past the light's pixel is none.
  if(i!=0){stored=select(1e10,stored,along[i]>0.0);}
  bendDepths[i*${BEND_WAVE}+lane]=stored;
 }
 workgroupBarrier();
 let first=lane+1u;
 // The window of a sample, in the units of the projected depths: the thickness over what is left of the depth, and never narrower than the one
 // the light's pixel allows.
 let scale=min(along[0]+direction,1.0/bend.tune.x)*along[0]/thickness[0];
 let origin=(sampling[0]-bend.light.z)/along[0]*scale+1.0;
 var hardPacked=bitcast<u32>(1.0);
 var packed=vec4u(bitcast<u32>(1.0));
 var hard=1.0;
 var values=vec4f(1.0);
 for(var i=0u;i<${BEND_SAMPLES}u;i++){
  var gap=abs(origin-bendDepths[first+i]*scale);
  if(i>=${BEND_SAMPLES - BEND_FADE}u){gap+=f32(i+1u-${BEND_SAMPLES - BEND_FADE}u)/${BEND_FADE + 1}.0*0.75;}
  if(trackHit){
   let word=(bitcast<u32>(gap)&0xffffff80u)|(i+1u);
   if(i<${BEND_HARD}u){hardPacked=min(hardPacked,word);}
   else{packed[i&3u]=min(packed[i&3u],word);}
  }else{
   if(i<${BEND_HARD}u){hard=min(hard,gap);}
   else{values[i&3u]=min(values[i&3u],gap);}
  }
 }
 var hitIndex=0u;
 if(trackHit){
  hitIndex=min(min(min(hardPacked,packed.x),min(packed.y,packed.z)),packed.w)&0x7fu;
  hard=bitcast<f32>(hardPacked);
  values=bitcast<vec4f>(packed);
 }
 let contrast=${BEND_CONTRAST}.0;
 values=saturate(values*contrast+(1.0-contrast));
 hard=saturate(hard*contrast+(1.0-contrast));
 // A pixel with no surface (the far plane's depth, 0) has no thickness to march: it is lit. The reference divides by it.
 let result=select(min(hard,dot(values,vec4f(0.25))),1.0,thickness[0]<=0.0);
 var occlusion=bend.intensity.x;
 if(INTENSITY_MODE==0u){
  let hit=vec2i(floor(startXY+f32(hitIndex)*(wave.delta*direction)/${BEND_WAVE}.0));
  let known=all(hit>=vec2i(0))&&all(hit<bend.wave.zw);
  let flags=select(0u,textureLoad(bendFlags,hit,${SURFACE_WORDS.flags},0).r,known);
  occlusion=select(bend.intensity.y,bend.intensity.x,hitCastsContactShadow(flags));
 }else if(INTENSITY_MODE==1u){
  let sceneDepth=vsmViewDepthOfDeviceZ(bendDepthAt(writeXY),bend.depthWords);
  let fade=saturate((sceneDepth-bend.intensity.z)*bend.intensity.w);
  occlusion=mix(bend.intensity.y,bend.intensity.x,fade);
 }
 if(all(writeXY>=vec2i(0))&&all(writeXY<bend.wave.zw)){
  textureStore(bendOut,writeXY,vec4f(1.0-(1.0-result)*occlusion,0.0,0.0,0.0));
 }
}
`,
)

/** The program of the screen-space shadow marched from a light's pixel (`BEND_ENTRY`), its intensity mode a pipeline constant (`INTENSITY_MODE`). */
export const BEND_WGSL = wgslProgram('', [SHADOW_BLOCK])
