import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { clipToFramebuffer, slabPerspective } from '../../../../../math/src/wgsl/projection.ts'
import { octDecode, octEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import { isFirstPerson } from '../../../materials/surface/surfaceModel.ts'
import { SCREEN_MARCH_WGSL } from '../../../visibility/hiz/gpu/screenMarch.ts'
import { SCREEN_MARCH_END_WGSL } from '../../../visibility/hiz/gpu/screenMarchBase.ts'
import type { MarchLanes } from '../../../visibility/hiz/gpu/screenMarchLanes.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../../reflections/constantsWgsl.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_GROUP,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../../reflections/viewLayout.ts'

/** The most lights (suns, or local lights) one run gives a self shadow: a layer each of the grid. */
export const SELF_SHADOW_MAX_LIGHTS = 8
/** The side of a workgroup, in threads. */
export const SELF_SHADOW_GROUP = 8
/** The hit distance, in pixels, that the half-resolution trace stores as the longest (`MaxPixelDistance`), and the share of one the longest is stored at. */
const MAX_PIXEL_DISTANCE = 64
const MAX_VALID_HIT = 254 / 255

/** The bindings of group 0, by kernel: the uniform, the surfaces, and the self shadow's own textures. */
export const SELF_SHADOW_BINDINGS = {
  params: 0,
  normals: 1,
  flags: 2,
  downInputs: 3,
  downDepth: 4,
  raw: 5,
  blurred: 6,
  lightMask: 7,
  lights: 8,
} as const
const B = SELF_SHADOW_BINDINGS

export const SELF_SHADOW_ENTRIES = {
  downsample: 'selfShadowDownsample',
  trace: 'selfShadowTrace',
  blur: 'selfShadowBlur',
  upsample: 'selfShadowUpsample',
} as const

/**
 * THE FIRST-PERSON SELF SHADOW (`shadowFirstPersonSelfShadow`): the shadow the pixels of the first-person objects take from one another,
 * traced in the screen, a light at a time, at half the resolution of the image unless the settings ask the full one. Four kernels:
 *
 * - `selfShadowDownsample`: each pixel of the half-resolution grid keeps, of its four, the first-person pixel with the lowest or the highest
 *   depth (the mode: the lowest value, the highest, or one then the other in a checkerboard) and its normal, octahedral at eight bits an
 *   axis, with its offset in the four; a grid pixel with no first-person pixel keeps the far depth (zero) and nothing else.
 * - `selfShadowTrace` (a layer of the grid a sun): from the pixel's point, moved off the surface along its normal by twice the distance to the corner of
 *   its texel measured along the normal, a ray toward the sun marches the depth pyramid (`screenMarch`, the reference's walk over the closest depth
 *   with the surface's thickness a share of its depth, its base level the lower of the full-resolution depth and its bilinear filter, with no depth plane there: `smooth`). A hit shadows the pixel; the grid keeps the distance, in pixels, from the pixel to the hit,
 *   as a share of 64 of them under 254/255, and one where nothing was hit. At the full resolution the shadow itself is taken into the sun's mask by the minimum.
 * - `selfShadowBlur`: a 3 x 3 filter weighed by the likeness of the depths, the shadow lerped from the pixel's own to the filtered by the mean hit
 *   distance of the neighbours that were hit (contact hardening).
 * - `selfShadowUpsample`: each first-person pixel of the image reads the four grid pixels around it, weighs them by the bilinear weights and the
 *   likeness of their depth to its own (the grid pixels with no first-person pixel weigh nothing), and takes the minimum of the sun's mask and the shadow;
 *   a local light's shadow is written into its layer of the mask (`lightMask`) as it is.
 * - `selfShadowMerge` (a fragment program, the local lights' only): the local light's layer, at the first-person pixels, taken into the light's
 *   own mask by the minimum (a blend), as the square root the masks keep.
 *
 * A layer is a sun, whose record is the direction toward it (`w` 0), or a local light, whose record is its rank in the light buffer (`x`, `w` 1): its
 * ray goes to the light's centre, ends there, and a pixel the light does not reach (`lightReaches`: its range, a spot's cone, a rectangle's face) is
 * not traced and stays lit.
 *
 * The depth is the device's, reversed: zero is the far plane. A shadow is a visibility, one for none, kept as it is (the reference stores its square
 * root in eight bits and squares it back to weigh).
 */
const PARAMS_WGSL = wgslBlock(
  'SELF_SHADOW_PARAMS_WGSL',
  [],
  `struct SelfShadow{
 sizes:vec4u,
 counts:vec4u,
 trace:vec4f,
 lights:array<vec4f,${SELF_SHADOW_MAX_LIGHTS}>,
}
@group(0) @binding(${B.params}) var<uniform> params:SelfShadow;
@group(0) @binding(${B.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${B.flags}) var flags:texture_2d<u32>;
@group(0) @binding(${B.downInputs}) var downInputs:texture_storage_2d<r32uint,read_write>;
@group(0) @binding(${B.downDepth}) var downDepth:texture_storage_2d<r32float,read_write>;
@group(0) @binding(${B.raw}) var rawShadow:texture_storage_2d_array<r32float,read_write>;
@group(0) @binding(${B.blurred}) var blurred:texture_storage_2d_array<r32float,read_write>;
@group(0) @binding(${B.lightMask}) var lightMask:texture_storage_2d_array<r32float,read_write>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
fn selfFirstPerson(pixel:vec2i)->bool{return isFirstPerson(textureLoad(flags,pixel,0).r);}
fn selfLow(p:vec2u)->bool{return all(p<params.sizes.zw);}`,
)

const DOWNSAMPLE_WGSL = `
@compute @workgroup_size(${SELF_SHADOW_GROUP},${SELF_SHADOW_GROUP},1)
fn ${SELF_SHADOW_ENTRIES.downsample}(@builtin(global_invocation_id) id:vec3u){
 if(!selfLow(id.xy)){return;}
 let last=params.sizes.xy-vec2u(1u);
 var minZ=0.0;var maxZ=0.0;var minAt=vec2u(0u);var maxAt=vec2u(0u);
 for(var y=0u;y<2u;y++){
  for(var x=0u;x<2u;x++){
   let full=min(id.xy*2u+vec2u(x,y),last);
   var z=hizOpaqueDepth(vec2i(full));
   if(z!=0.0){
    z=select(0.0,z,selfFirstPerson(vec2i(full)));
    if(z!=0.0&&(minZ==0.0||z<minZ)){minZ=z;minAt=full;}
    if(z!=0.0&&(maxZ==0.0||z>maxZ)){maxZ=z;maxAt=full;}
   }
  }
 }
 var lowest=false;
 switch params.counts.z{
  case 0u:{lowest=true;}
  case 2u:{lowest=((id.x+id.y)&1u)!=0u;}
  default:{}
 }
 let z=select(maxZ,minZ,lowest);
 textureStore(downDepth,id.xy,vec4f(z,0.0,0.0,0.0));
 if(z==0.0){textureStore(downInputs,id.xy,vec4u(0u));return;}
 let at=select(maxAt,minAt,lowest);
 let n=normalize(textureLoad(normals,vec2i(at),0).xyz);
 let oct=octEncode(n)*0.5+vec2f(0.5);
 let offset=at-min(id.xy*2u,last);
 let q=vec2u(round(saturate(oct)*255.0));
 textureStore(downInputs,id.xy,vec4u(q.x|(q.y<<8u)|(offset.x<<16u)|(offset.y<<24u),0u,0u,0u));
}`

const TRACE_WGSL = (lanes: MarchLanes) => `
struct SelfInputs{pixel:vec2u,z:f32,n:vec3f,ok:bool,}
fn selfInputs(id:vec2u)->SelfInputs{
 if(params.counts.y!=0u){
  if(any(id>=params.sizes.xy)){return SelfInputs(id,0.0,vec3f(0.0),false);}
  let z=hizOpaqueDepth(vec2i(id));
  let ok=z!=0.0&&selfFirstPerson(vec2i(id));
  return SelfInputs(id,z,normalize(textureLoad(normals,vec2i(id),0).xyz),ok);
 }
 if(!selfLow(id)){return SelfInputs(id,0.0,vec3f(0.0),false);}
 let z=textureLoad(downDepth,id).x;
 let word=textureLoad(downInputs,id).x;
 let oct=vec2f(f32(word&255u),f32((word>>8u)&255u))/255.0*2.0-vec2f(1.0);
 let pixel=min(id*2u+vec2u((word>>16u)&255u,(word>>24u)&255u),params.sizes.xy-vec2u(1u));
 return SelfInputs(pixel,z,octDecode(oct),z!=0.0);
}
@compute @workgroup_size(${SELF_SHADOW_GROUP},${SELF_SHADOW_GROUP},1)
fn ${SELF_SHADOW_ENTRIES.trace}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 ${lanes === 'polyfill' ? 'screenMarchLane=lane;' : ''}
 let layer=i32(id.z);
 let inputs=selfInputs(id.xy);
 let size=view.viewport.xy;
 let light=params.lights[id.z];
 let local=light.w!=0.0;
 let rank=u32(light.x);
 var S0=vec3f(0.0);var delta=vec3f(0.0);var end=0.0;var pixels=0.0;
 let full=vec2f(inputs.pixel)+vec2f(0.5);
 let P=worldAt(full,inputs.z);
 // A local light the pixel is out of the reach of leaves it lit, and traces no ray.
 if(inputs.ok&&(!local||lightReaches(rank,P))){
  let corner=worldAt(full+vec2f(0.5),inputs.z);
  let origin=P+abs(dot(corner-P,inputs.n))*2.0*inputs.n;
  let A=reflectionView.viewProj*vec4f(origin,1.0);
  if(all(abs(A.xy)<=vec2f(A.w))){
   // A sun's ray goes on to the trace distance, a local light's ends at the light.
   var toLight=vec3f(0.0);
   if(local){toLight=directLights.items[rank].positionRange.xyz-origin;}
   let lightDistance=length(toLight);
   let dir=select(normalize(light.xyz),toLight/max(lightDistance,1e-4),local);
   let toward=reflectionView.viewProj*vec4f(dir,0.0);
   let ends=select(select(1e30,0.99*(reflectionView.slab.y-A.z)/toward.z,toward.z>0.0),select(1e30,-0.99*A.w/toward.w,toward.w<0.0),slabPerspective(reflectionView.slab));
   let span=min(min(params.trace.x,select(1e27,lightDistance,local)),ends);
   S0=clipToFramebuffer(A,size);
   delta=clipToFramebuffer(A+toward*span,size)-S0;
   end=screenMarchEnd(S0.xy,delta.xy,size);
   pixels=select(REFLECTION_THICKNESS,params.trace.z/reflectionView.slab.x,slabPerspective(reflectionView.slab));
  }
 }
 // Every thread of the group takes part in the march, one with no ray with an end of zero.
 let marched=screenMarch(S0,delta,end,pixels,params.trace.z,reflectionView.slab,u32(params.trace.y),true${lanes === 'none' ? '' : ',params.counts.w'});
 if(!inputs.ok){
  if(params.counts.y==0u&&selfLow(id.xy)){textureStore(rawShadow,id.xy,layer,vec4f(1.0));}
  return;
 }
 let hit=end>0.0&&marched.t>=0.0&&marched.plane.x>0.0;
 if(params.counts.y!=0u){
  // A sun's mask is taken by the minimum, so only a hit writes; a local light's layer holds the shadow of every first-person pixel.
  if(hit||local){
   textureStore(lightMask,id.xy,layer,vec4f(select(1.0,0.0,hit)));
  }
  return;
 }
 var stored=1.0;
 if(hit){
  let reached=S0.xy+delta.xy*marched.t;
  stored=saturate(distance(reached,full)/${MAX_PIXEL_DISTANCE}.0)*${MAX_VALID_HIT};
 }
 textureStore(rawShadow,id.xy,layer,vec4f(stored));
}`

const BLUR_WGSL = `
struct BlurIn{z:f32,depth:f32,hit:f32,shadow:f32,}
fn blurIn(p:vec2i,layer:i32)->BlurIn{
 if(any(p<vec2i(0))||any(vec2u(p)>=params.sizes.zw)){return BlurIn(0.0,0.0,0.0,0.0);}
 let z=textureLoad(downDepth,p).x;
 if(z==0.0){return BlurIn(0.0,0.0,0.0,0.0);}
 let packed=textureLoad(rawShadow,p,layer).x;
 return BlurIn(z,reflectionLinearOfDevice(z),select(-1.0,packed/${MAX_VALID_HIT},packed!=1.0),select(1.0,0.0,packed!=1.0));
}
@compute @workgroup_size(${SELF_SHADOW_GROUP},${SELF_SHADOW_GROUP},1)
fn ${SELF_SHADOW_ENTRIES.blur}(@builtin(global_invocation_id) id:vec3u){
 if(!selfLow(id.xy)){return;}
 let layer=i32(id.z);
 let p=vec2i(id.xy);
 let centre=blurIn(p,layer);
 if(centre.z==0.0){textureStore(blurred,id.xy,layer,vec4f(1.0));return;}
 var shadowSum=centre.shadow;var shadowWeight=1.0;
 var hitSum=select(0.0,centre.hit,centre.hit>0.0);var hitWeight=select(0.0,1.0,centre.hit>0.0);
 for(var k=0;k<9;k++){
  if(k==4){continue;}
  let s=blurIn(p+vec2i(k%3-1,k/3-1),layer);
  if(s.z==0.0){continue;}
  let w=min(1.0,1.0/(params.trace.w*abs(centre.depth-s.depth)+1e-4));
  shadowSum+=s.shadow*w;shadowWeight+=w;
  if(s.hit>0.0){hitSum+=s.hit*w;hitWeight+=w;}
 }
 let average=select(0.0,hitSum/hitWeight,hitWeight>1e-5);
 let filtered=shadowSum/shadowWeight;
 textureStore(blurred,id.xy,layer,vec4f(mix(centre.shadow,filtered,saturate(average))));
}`

const UPSAMPLE_WGSL = `
@compute @workgroup_size(${SELF_SHADOW_GROUP},${SELF_SHADOW_GROUP},1)
fn ${SELF_SHADOW_ENTRIES.upsample}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=params.sizes.xy)||!selfFirstPerson(vec2i(id.xy))){return;}
 let layer=i32(id.z);
 let low=vec2f(id.xy)*0.5+vec2f(0.25);
 let base=vec2i(floor(low-vec2f(0.5)));
 let f=fract(low-vec2f(0.5));
 var at=array<vec2i,4>(base+vec2i(0,1),base+vec2i(1,1),base+vec2i(1,0),base);
 let weights=vec4f((1.0-f.x)*f.y,f.x*f.y,f.x*(1.0-f.y),(1.0-f.x)*(1.0-f.y));
 let sceneDepth=reflectionLinearOfDevice(hizOpaqueDepth(vec2i(id.xy)));
 var depthWeights=vec4f(0.0);var shadows=vec4f(1.0);
 for(var k=0;k<4;k++){
  let q=clamp(at[k],vec2i(0),vec2i(params.sizes.zw)-vec2i(1));
  let z=textureLoad(downDepth,q).x;
  if(z!=0.0){depthWeights[k]=min(1.0,1.0/(params.trace.w*abs(sceneDepth-reflectionLinearOfDevice(z))+1e-4));}
  shadows[k]=textureLoad(blurred,q,layer).x;
 }
 var total=depthWeights*weights;
 let sum=dot(total,vec4f(1.0));
 total=select(weights,total/sum,sum>1e-5);
 let shadow=dot(shadows,total);
 let held=textureLoad(lightMask,id.xy,layer).x;
 textureStore(lightMask,id.xy,layer,vec4f(select(min(held,shadow),shadow,params.lights[id.z].w!=0.0),0.0,0.0,0.0));
}`

/** The program of the kernel `entry`: the self shadow's textures in group 0 and the reflection's group (the view, the depth pyramid and the lighting's view)
 *  in `REFLECTION_GROUP`. `lanes`: the march gives up on its lanes' occupancy (`shadowFirstPersonSelfShadowMinimumHzbTraceOccupancy` above 0, the polyfill)
 *  or never. */
export function selfShadowProgram(
  entry: (typeof SELF_SHADOW_ENTRIES)[keyof typeof SELF_SHADOW_ENTRIES],
  lanes: MarchLanes,
) {
  const kernels = {
    [SELF_SHADOW_ENTRIES.downsample]: DOWNSAMPLE_WGSL,
    [SELF_SHADOW_ENTRIES.trace]: TRACE_WGSL(lanes),
    [SELF_SHADOW_ENTRIES.blur]: BLUR_WGSL,
    [SELF_SHADOW_ENTRIES.upsample]: UPSAMPLE_WGSL,
  }
  const kernel = kernels[entry]!
  return wgslProgram(kernel, [
    PARAMS_WGSL,
    DIRECT_LIGHT_WGSL,
    isFirstPerson,
    octEncode,
    octDecode,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    REFLECTION_LINEAR_DEPTH_WGSL,
    SCREEN_MARCH_WGSL(
      REFLECTION_GROUP,
      REFLECTION_DEPTH_BINDING,
      lanes,
      SELF_SHADOW_GROUP ** 2,
      true,
    ),
    SCREEN_MARCH_END_WGSL,
    clipToFramebuffer,
    slabPerspective,
  ])
}

/** The merge's entry point and the bindings of its group: a local light's layer of the self shadow, and the surfaces' flags. */
export const SELF_SHADOW_MERGE_ENTRY = 'selfShadowMerge'
export const SELF_SHADOW_MERGE_BINDINGS = { shadow: 0, flags: 1 } as const

/**
 * The merge of a local light's self shadow into the light's mask (`selfShadowMerge`, a fragment program over the full-screen triangle): the
 * first-person pixels write the square root of the shadow, the others nothing; the pipeline's blend takes the minimum of that and the mask
 * (`CAPSULE_BLENDS.attenuation`), so every other shadow of the light stands.
 */
export const selfShadowMergeProgram = () =>
  wgslProgram(
    `@group(0) @binding(${SELF_SHADOW_MERGE_BINDINGS.shadow}) var shadowLayer:texture_2d<f32>;
@group(0) @binding(${SELF_SHADOW_MERGE_BINDINGS.flags}) var surfaceFlags:texture_2d<u32>;
@fragment fn ${SELF_SHADOW_MERGE_ENTRY}(@builtin(position) at:vec4f)->@location(0) vec4f{
 let pixel=vec2i(at.xy);
 if(!isFirstPerson(textureLoad(surfaceFlags,pixel,0).r)){discard;}
 return vec4f(sqrt(textureLoad(shadowLayer,pixel,0).x));
}`,
    [isFirstPerson, FULLSCREEN_VERTEX],
  )
