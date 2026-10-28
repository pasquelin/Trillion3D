/**
 * THE SCREEN TRACE OF THE SAMPLES' RAYS: for each sample whose ray is still to be traced, a march of the image's depth pyramid (`screenMarch`, the engine's
 * one, over the reflection group's pyramid) from the sample's surface toward the point of its light (`lightSampleTrace`), as far as
 * `sampledLightsScreenTraceDistance` or the light. The surface's point is moved off it along its normal, and the march hits what is a share
 * `sampledLightsScreenTraceThickness` of its depth thick. A ray that meets a surface shadows the sample (`visible` false) and is complete; one that
 * reaches the light is complete and visible; one that stopped short, leaving the screen or running out of iterations, keeps the distance it was clear to
 * (the ray word's), where the passes after it go on. Rays of a hair pixel, a two-sided or a transmitting surface are the later passes'.
 * One thread a sample, over the samples' texture.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { clipToFramebuffer, slabPerspective } from '../../../../math/src/wgsl/projection.ts'
import { SURFACE_COLOUR_LAYERS } from '../../materials/surface/surfaceOutputs.ts'
import { SCREEN_MARCH_WGSL } from '../../visibility/hiz/gpu/screenMarch.ts'
import { SCREEN_MARCH_END_WGSL } from '../../visibility/hiz/gpu/screenMarchBase.ts'
import { AIR_GEOMETRY_WGSL } from '../atmosphere/geometryWgsl.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { channelsOfFlags } from '../../materials/surface/surfaceChannels.ts'
import { lightChannelsOf } from '../direct/lightReachWgsl.ts'
import { COLOURS_BINDING_WGSL, WORDS_BINDING_WGSL } from '../deferred/litSurfaceWgsl.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../reflections/constantsWgsl.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_GROUP,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../reflections/viewLayout.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { LIGHT_TRACE_WGSL } from './lightTraceWgsl.ts'
import {
  RAY_TYPE,
  lightSampleIndex,
  lightSampleRayType,
  lightSampleRayUv,
} from './lightSamplerWgsl.ts'
import { COMPACT_THREADS, TRACE_TEXEL_WGSL } from './compactWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { JITTER_WGSL } from './samplingWgsl.ts'

const B = SAMPLED_BINDINGS

export const SCREEN_TRACE_ENTRY = 'screenTraceMain'

/** The samples and their rays, read and written in place. */
export const SAMPLE_IO_WGSL = wgslBlock(
  'SAMPLED_SAMPLE_IO_WGSL',
  [],
  `@group(0) @binding(${B.samples}) var samples:texture_storage_2d<r32uint,read_write>;
@group(0) @binding(${B.rays}) var rays:texture_storage_2d<r32uint,read_write>;
/** The sample at 'c' found shadowed ('hit') or visible, its ray complete. */
fn completeSample(c:vec2i,hit:bool){
 let word=textureLoad(samples,c).r;
 textureStore(samples,c,vec4u((word&0x7FFFFFFFu)|select(0x80000000u,0u,hit),0u,0u,0u));
 textureStore(rays,c,vec4u((textureLoad(rays,c).r&0xFFFF0000u)|0x8000u,0u,0u,0u));
}
/** The sample at 'c' found shadowed, its ray as it is. */
fn hideSample(c:vec2i){
 let word=textureLoad(samples,c).r;
 textureStore(samples,c,vec4u(word&0x7FFFFFFFu,0u,0u,0u));
}
/** The ray at 'c' left to go on from 'distance'. */
fn continueRay(c:vec2i,distance:f32){
 textureStore(rays,c,vec4u((textureLoad(rays,c).r&0xFFFF8000u)|(pack2x16float(vec2<f32>(distance,0.0))&0x7FFFu),0u,0u,0u));
}`,
)

const SCREEN_PART_1 = `
@group(0) @binding(${B.compactData}) var<storage,read> compactData:array<u32>;
@group(0) @binding(${B.compactCount}) var<storage,read> compactCount:array<u32>;
@compute @workgroup_size(${COMPACT_THREADS},1,1)
fn ${SCREEN_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=compactCount[0]||params.screenTrace.x==0u){return;}
 let texel=unpackTraceTexel(compactData[id.x]);
 let c=vec2i(texel);
 let ray=textureLoad(rays,c).r;
 let kind=lightSampleRayType(ray);
 let index=lightSampleIndex(textureLoad(samples,c).r);
 let light=directLights.items[index];
 let down=texel/params.samples;
 let screen=min(down*params.factor+downsampleJitter(down),vec2u(view.viewport.xy)-vec2u(1u));
 let pixel=vec2i(screen);
 let z=hizOpaqueDepth(pixel);
 var P=worldAt(vec2f(screen)+vec2f(0.5),z);
 let N=normalize(textureLoad(colours,pixel,${SURFACE_COLOUR_LAYERS.normal},0).xyz);
 let segment=lightSampleTrace(index,P,lightSampleRayUv(ray));
 let dir=segment.xyz;
 // A hair pixel's ray starts along itself; any other off the surface along its normal.
 if(kind==${RAY_TYPE.hair}u){P+=dir*params.trace.w;}else{P+=N*params.trace.z;}
 var reach=clamp(segment.w-0.01,0.0,params.trace.x);
 // A hair pixel under a light that casts no shadow keeps a short ray, for the hair's own shadow.
 if(kind==${RAY_TYPE.hair}u&&!castsShadow(light)){reach=min(reach,params.hair.x);}
 let size=view.viewport.xy;
 let A=reflectionView.viewProj*vec4f(P,1.0);
 if(A.w<=0.0||any(abs(A.xy)>vec2f(A.w))){
  continueRay(c,0.0);
  return;
 }
 let toward=reflectionView.viewProj*vec4f(dir,0.0);
 // A ray toward the eye ends where its depth is a hundredth of its origin's view depth (as the screen probes' does, under either projection).
 let ends=select(select(1e30,0.99*(reflectionView.slab.y-A.z)/toward.z,toward.z>0.0),select(1e30,-0.99*A.w/toward.w,toward.w<0.0),slabPerspective(reflectionView.slab));
 let span=min(reach,ends);
 let S0=clipToFramebuffer(A,size);
 let B=A+toward*span;
 let delta=clipToFramebuffer(B,size)-S0;
 let end=screenMarchEnd(S0.xy,delta.xy,size);
 let relative=params.trace.y;
 let pixels=select(REFLECTION_THICKNESS,relative/reflectionView.slab.x,slabPerspective(reflectionView.slab));
 let marched=screenMarch(S0,delta,end,pixels,relative,reflectionView.slab,params.screenTrace.y,true);
 var hit=marched.t>=0.0&&marched.plane.x>0.0;
 var rayT=0.0;
 if(hit){
`
const SCREEN_PART_2 = `  let H=S0+delta*marched.t;
  // What the ray met must be a surface that shares a lighting channel with the light.
  let hitFlags=textureLoad(words,vec2i(floor(H.xy)),${SURFACE_WORDS.flags},0).r;
  if((channelsOfFlags(hitFlags)&lightChannelsOf(light))==0u){hit=false;}
  rayT=distance(worldAt(H.xy,H.z),P);
 }else{
  // Where the march proved the ray clear, as a share of the screen's way turned into the share of the clip's.
  let stop=select(marched.t,marched.above,marched.t<0.0);
  rayT=span*stop*A.w/(stop*A.w+(1.0-stop)*max(B.w,1e-6));
 }
 // A ray that crosses the sphere of a first-person object's stand-ins is handed on no further than where it enters it.
 let stands=reflectionView.firstPerson;
 if(stands.w>0.0){
  let crossing=raySphere(P-stands.xyz,dir,stands.w);
  if(crossing.y>0.0){rayT=min(rayT,max(crossing.x,params.hair.y));}
 }
 if(hit){
  completeSample(c,true);
 }else if(rayT>=segment.w*0.999){
  completeSample(c,false);
 }else{
  continueRay(c,rayT);
 }
}`

export const screenTraceWgsl = () =>
  wgslProgram(`${SCREEN_PART_1}${SCREEN_PART_2}`, [
    SAMPLED_PARAMS_WGSL,
    JITTER_WGSL,
    SAMPLE_IO_WGSL,
    TRACE_TEXEL_WGSL,
    LIGHT_TRACE_WGSL,
    LIGHTS_BINDING_WGSL,
    COLOURS_BINDING_WGSL,
    WORDS_BINDING_WGSL,
    channelsOfFlags,
    lightChannelsOf,
    WORLD_AT_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    AIR_GEOMETRY_WGSL,
    SCREEN_MARCH_WGSL(REFLECTION_GROUP, REFLECTION_DEPTH_BINDING),
    SCREEN_MARCH_END_WGSL,
    clipToFramebuffer,
    slabPerspective,
    lightSampleIndex,
    lightSampleRayType,
    lightSampleRayUv,
  ])
