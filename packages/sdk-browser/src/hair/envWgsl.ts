import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../math/src/wgsl/constants.ts'
import { clipToFramebuffer, slabPerspective } from '../../../math/src/wgsl/projection.ts'
import {
  hammersley16,
  r2Sequence,
  rand3dPcg16,
  sampleSphereEven,
} from '../../../math/src/wgsl/sampling.ts'
import { blueNoiseWgsl } from '../gpu/noise/blueNoiseWgsl.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { SCREEN_MARCH_WGSL } from '../visibility/hiz/gpu/screenMarch.ts'
import { SCREEN_MARCH_END_WGSL } from '../visibility/hiz/gpu/screenMarchBase.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../lighting/reflections/constantsWgsl.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from '../lighting/reflections/field.ts'
import { WORLD_AT_WGSL } from '../lighting/deferred/worldAtWgsl.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_GROUP,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../lighting/reflections/viewLayout.ts'
import { hairScatteringWgsl, HAIR_COMPONENT } from './hairBsdfWgsl.ts'
import { HAIR_SAMPLE_WGSL } from './sampleWgsl.ts'
import { VOXEL_COMMON_WGSL } from './voxelWgsl.ts'
import { HAIR_VOXEL_JITTER_WGSL, voxelTraversalWgsl } from './voxelTraversalWgsl.ts'
import { HAIR_NODE_COUNTER_STORED, HAIR_NODE_GROUP_SIZE } from './visibilityMath.ts'

/** The format of the grid the environment's light is written to: the strands' light's (`HAIR_LIGHT_FORMAT`). */
const ENV_FORMAT = 'rgba16float'

/** How the strands take the environment's light (`hairEnvironmentIntegration`). */
export type HairEnvironmentMode = 'sh' | 'adhoc' | 'uniform'
/** Where the light along a direction is gathered from: the radiance cache the screen probes read (a stage of their pass), or the sky light (a pass of its own, the world lit by no probe). */
export type HairEnvironmentGather = 'cache' | 'sky'

/** The bindings of the environment kernel's own group (group 2): the samples, the table of the fibre's scattering and
 *  its sampler (the next binding), the parameters and the grid written; for the integrations that trace the voxels, the volume's parameters, nodes, page index and voxels. */
export const HAIR_ENV_GROUP = {
  nodeCoord: 0,
  nodeData: 1,
  nodeCounter: 2,
  lut: 3,
  params: 5,
  out: 6,
  voxelParams: 8,
  voxelNodes: 9,
  voxelPageIndex: 10,
  voxels: 11,
  blueNoise: 12,
} as const
/** The steps of the march of a strand's ray against the screen: the reference's. */
const HAIR_SCREEN_TRACE_STEPS = 4
/** The entry point of the kernel. */
export const HAIR_ENV_ENTRY = 'hairRadiance'
/** The words of the parameters block (`HairEnvParams`). */
export const HAIR_ENV_PARAM_WORDS = 12

const G = HAIR_ENV_GROUP
const C = HAIR_COMPONENT

/** The sphere, evenly, of a point of the unit square, as the reference draws its directions. */
const SAMPLING = `
fn hairRandomFour(pixel:vec2u,it:u32,count:u32)->vec4f{
 let first=rand3dPcg16(vec3i(vec2i(pixel),i32(hairEnv.frame%8u))).xy;
 let second=rand3dPcg16(vec3i(vec2i(pixel)+vec2i(17),i32(hairEnv.frame%8u))).xy;
 return vec4f(hammersley16(it,count,first),hammersley16(it,count,second));
}
fn hairPositionBias(direction:vec3f,offset:vec3f,voxelSize:f32)->vec3f{
 return voxelSize*(offset+direction*hairEnv.depthBias);
}
fn hairToGgxTrt(roughness:f32)->f32{
 let x=saturate(roughness);
 let x2=x*x;
 let x3=x2*x;
 let x4=x2*x2;
 return (-0.207704*x+6.95267*x2-10.1783*x3+4.24751*x4)/(-1.96947*x+3.37235*x2);
}
fn hairToGgxTt(roughness:f32)->f32{
 let x=saturate(roughness);
 let x2=x*x;
 let x3=x2*x;
 return 0.70505*x-0.117104*x2+0.0259047*x3;
}
fn hairMostOf(c:vec3f)->f32{return max(c.x,max(c.y,c.z));}
`

/** The hair on the way from `p0` to `p1` in the volume of the macro group `node`, counted in its voxels and with the opaque marks (the environment's density and stepping). */
const VOXEL_TEXT = `
fn hairCountVoxel(node:VoxelNode,p0:vec3f,p1:vec3f,distance:f32)->Traversal{
 return traceVoxels(p0,p1,node,TraversalSettings(hairEnv.densityScale,opaqueVoxelValue(),distance,hairEnv.stepping,vec3f(0.0),0.0,false,true));
}
fn hairTransmittanceOnly(count:f32,visibility:f32,colour:vec3f,roughness:f32,sinLight:f32)->vec3f{
 // The first strand counts for nothing: the power starts at zero for hair facing the light.
 let shifted=max(0.0,count-1.0);
 return pow(sampleHairLut(colour,roughness,sinLight).front,vec3f(shifted))*visibility;
}
`

/** The ray against the screen: whether the depth the image drew lets a ray of the strands out, a short march through the depth pyramid (the reference's `GetRayVisibility`). */
const SCREEN_TEXT = `
fn hairRayVisibility(P:vec3f,pixel:vec2u,z:f32,direction:vec3f)->f32{
 if(hairEnv.screenTrace==0u){return 1.0;}
 let origin=P+direction*0.001;
 let A=reflectionView.viewProj*vec4f(origin,1.0);
 if(A.w<=0.0||any(abs(A.xy)>vec2f(A.w))){return 1.0;}
 let size=view.viewport.xy;
 let reach=distance(worldAt(vec2f(pixel)+vec2f(hairEnv.traceLength,0.0),z),worldAt(vec2f(pixel),z));
 let toward=reflectionView.viewProj*vec4f(direction,0.0);
 let ends=select(select(1e30,0.99*(reflectionView.slab.y-A.z)/toward.z,toward.z>0.0),select(1e30,-0.99*A.w/toward.w,toward.w<0.0),slabPerspective(reflectionView.slab));
 let span=min(reach,ends);
 let S0=clipToFramebuffer(A,size);
 let B=A+toward*span;
 let delta=clipToFramebuffer(B,size)-S0;
 let end=screenMarchEnd(S0.xy,delta.xy,size);
 let relative=reflectionView.march.x;
 let thickness=select(REFLECTION_THICKNESS,relative/reflectionView.slab.x,slabPerspective(reflectionView.slab));
 let marched=screenMarch(S0,delta,end,thickness,relative,reflectionView.slab,${HAIR_SCREEN_TRACE_STEPS}u,true);
 return select(1.0,0.0,marched.t>=0.0&&marched.plane.x>0.0);
}
`

/** The light along `d` of a cone as wide as `roughness` says: the cache's (zero where it covers no point), or the sky light's. */
const gatherText = (gather: HairEnvironmentGather) =>
  gather === 'cache'
    ? `fn hairGather(P:vec3f,d:vec3f,roughness:f32)->vec3f{
 if(!spFlag(SP_FLAG_CACHE)){return vec3f(0.0);}
 spCacheGatherOwn(P);
 if(!spCacheCovers()){return vec3f(0.0);}
 let cone=saturate(roughness*0.8);
 return spCacheSample(P,d,max(1.0,f32(spCacheRes())*sin(cone*0.5))).radiance;
}`
    : `fn hairGather(P:vec3f,d:vec3f,roughness:f32)->vec3f{return reflectionEnvironment(d,roughness);}`

/** The default integration: the light along `L`, the view's direction less its part along the fibre, weighed by the fibre's response (`PI` times the BSDF, held to 1) under no hair. */
const SH_TEXT = `
 let L=normalize(V-T*dot(V,T));
 let td=hairTransmittance(V,L,strand.colour,strand.roughness,0.0,T,vec2f(0.0,1.0),hairEnv.components);
 let response=min(vec3f(1.0),PI*hairShading(strand.colour,strand.roughness,strand.specular,strand.scatter,1.0,L,V,T,1.0,td,0.0,0.2));
 light=hairGather(P,L,strand.roughness)*view.preExposure.x*response*hairRayVisibility(P,strand.pixel,strand.z,L);
`

/**
 * The ad hoc integration: the hair on the way of `sampleCount` directions of the sphere is counted in the voxels, each direction giving the fibre's
 * dual scattering (the average of the product of its local and global scattering, and the direction the light is least occluded from); the multiple-scattering
 * term gathers the light along that direction, bent toward the fibre's own reflection, at a widened roughness; the reflection term gathers it along the same
 * direction, its transmittance and the fibre's BSDF counted along it. The transmission term (TT) is off in the reference.
 */
const ADHOC_TEXT = `
 let node=nodeOf(strand.owner);
 let count=max(hairEnv.sampleCount,1u);
 var unoccluded=-V;
 var dual=vec3f(0.0);
 if((hairEnv.components&${C.r | C.tt | C.trt}u)!=0u){
  let scattering=(hairEnv.components&${C.r | C.trt}u)|${C.localScattering | C.globalScattering}u;
  var mean=vec3f(0.0);
  for(var it=0u;it<count;it++){
   let random=hairRandomFour(strand.pixel,it,count);
   let L=sampleSphereEven(fract(random.xy));
   let start=Pt+hairPositionBias(L,L*random.z,node.size);
   let found=hairCountVoxel(node,start,start+L*hairEnv.distance,hairEnv.distance);
   let td=hairTransmittance(V,L,strand.colour,strand.roughness,0.0,T,vec2f(found.hairCount,found.visibility),scattering);
   dual+=td.localScattering*td.globalScattering*found.visibility;
   mean+=L*hairMostOf(td.globalScattering*found.visibility);
  }
  dual*=4.0*PI/f32(count);
  let norm=sqrt(dot(mean,mean));
  if(norm>0.0){unoccluded=mean/norm;}
 }
 var fake=normalize(V-T*dot(V,T));
 let reflectedBack=2.0*dot(V,fake)*fake-V;
 var colourMs=vec3f(0.0);
 if((hairEnv.components&${C.r | C.tt | C.trt}u)!=0u){
  var R=unoccluded;
  R=normalize(mix(reflectedBack,R,0.4));
  colourMs=view.preExposure.x*hairGather(P,R,hairToGgxTt(strand.roughness)*2.0)*dual;
 }
 var colourR=vec3f(0.0);
 if((hairEnv.components&${C.r | C.trt}u)!=0u){
  var R=2.0*dot(V,unoccluded)*unoccluded-V;
  R=normalize(mix(reflectedBack,R,0.4));
  colourR=view.preExposure.x*hairGather(P,R,hairToGgxTrt(strand.roughness));
  let start=Pt+hairPositionBias(R,hairVoxelJitter(strand.pixel,strand.owner,hairEnv.frame,hairEnv.jitterMode),node.size);
  let found=hairCountVoxel(node,start,start+R*hairEnv.distance,hairEnv.distance);
  var td=hairStrandsTransmittanceInit(true);
  td.opaqueVisibility=found.visibility;
  td.globalScattering=hairTransmittanceOnly(found.hairCount,found.visibility,strand.colour,strand.roughness,dot(R,T));
  td.components=(hairEnv.components&${C.r | C.trt}u)|${C.multiScatter}u;
  colourR*=hairShading(strand.colour,strand.roughness,strand.specular,strand.scatter,1.0,R,V,T,1.0,td,0.0,0.2)*found.visibility;
 }
 light=colourR+colourMs;
`

/** The blue noise the uniform integration's jitter reads. */
const UNIFORM_NOISE = `
// The blue noise of the pixel for the sample \`it\` of \`count\`, two vectors of the unit square: the reference's jitter of its uniform integration.
fn hairBlueNoiseFour(pixel:vec2u,it:u32,count:u32)->vec4f{
 let size=vec2f(BLUE_NOISE_TILE.xy);
 let time=hairEnv.frame%8u;
 return vec4f(blueNoiseVec2(pixel+vec2u(r2Sequence(it)*size),time),blueNoiseVec2(pixel+vec2u(r2Sequence(it+count)*size),time));
}
`

/** The uniform integration: `sampleCount` directions spread evenly over the sphere, each weighed by the fibre's BSDF under the hair counted on its way and the screen's visibility, and by the light gathered along it. */
const UNIFORM_TEXT = `
 let node=nodeOf(strand.owner);
 let count=max(hairEnv.sampleCount,1u);
 var accumulated=vec3f(0.0);
 for(var it=0u;it<count;it++){
  let random=hairBlueNoiseFour(strand.pixel,it,count);
  let L=sampleSphereEven(fract(random.xy));
  let start=Pt+hairPositionBias(L,random.z*L,node.size);
  var found=hairCountVoxel(node,start,start+L*hairEnv.distance,hairEnv.distance);
  let td=hairTransmittance(V,L,strand.colour,strand.roughness,0.0,T,vec2f(found.hairCount,found.visibility),hairEnv.components);
  if(found.visibility>0.0){found.visibility*=hairRayVisibility(P,strand.pixel,strand.z,L);}
  accumulated+=hairShading(strand.colour,strand.roughness,strand.specular,strand.scatter,1.0,L,V,T,1.0,td,1.0,0.0)*found.visibility*hairGather(P,L,0.1);
 }
 light=4.0*PI*accumulated/f32(count)*view.preExposure.x;
`

const voxelDeclarations = `
@group(2) @binding(${G.voxelParams}) var<uniform> params:VoxelParams;
@group(2) @binding(${G.voxelNodes}) var<storage,read> nodes:array<u32>;
@group(2) @binding(${G.voxelPageIndex}) var<storage,read> pageIndex:array<u32>;
@group(2) @binding(${G.voxels}) var<storage,read> voxels:array<u32>;
`

/**
 * THE STRANDS' LIGHT FROM THE ENVIRONMENT, one kernel a sample for the integration `mode` and the gather `gather` (`HairEnvironmentMode`, `HairEnvironmentGather`): the light along the
 * directions the integration picks is gathered from the radiance cache the screen probes read (a stage of their pass) or from the sky light (a pass of its own where
 * the world is lit by no probe), weighed as the integration says, multiplied by the pre-exposure and by the share of the pixel the sample covers; none for a sample that
 * scatters the scene's light. The result is written to the grid of the samples, where the sky pass of the strands reads it in place of the sky light's.
 */
export const hairEnvKernel = (mode: HairEnvironmentMode, gather: HairEnvironmentGather) =>
  wgslBlock(
    `HAIR_ENV_KERNEL(${mode}, ${gather})`,
    [
      HAIR_SAMPLE_WGSL,
      hairScatteringWgsl(2, G.lut),
      PI,
      FLAT_INDEX_WGSL,
      hammersley16,
      rand3dPcg16,
      r2Sequence,
      sampleSphereEven,
      REFLECTION_CONSTANTS_WGSL,
      WORLD_AT_WGSL,
      reflectionBindingsWgsl(REFLECTION_GROUP),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      SCREEN_MARCH_WGSL(REFLECTION_GROUP, REFLECTION_DEPTH_BINDING),
      SCREEN_MARCH_END_WGSL,
      clipToFramebuffer,
      slabPerspective,
      ...(gather === 'sky' ? [REFLECTION_ENVIRONMENT_WGSL] : []),
      ...(mode === 'sh'
        ? []
        : [VOXEL_COMMON_WGSL, voxelTraversalWgsl(true), HAIR_VOXEL_JITTER_WGSL]),
      ...(mode === 'uniform' ? [blueNoiseWgsl(2, G.blueNoise)] : []),
    ],
    `@group(2) @binding(${G.nodeCoord}) var<storage,read> hairCoord:array<u32>;
@group(2) @binding(${G.nodeData}) var<storage,read> hairData:array<u32>;
@group(2) @binding(${G.nodeCounter}) var<storage,read> hairCounter:array<u32>;
struct HairEnvParams{
 components:u32,sampleCount:u32,frame:u32,jitterMode:u32,
 distance:f32,densityScale:f32,depthBias:f32,stepping:f32,
 screenTrace:u32,pad0:u32,traceLength:f32,pad1:f32}
@group(2) @binding(${G.params}) var<uniform> hairEnv:HairEnvParams;
@group(2) @binding(${G.out}) var hairEnvOut:texture_storage_2d<${ENV_FORMAT},write>;${mode === 'sh' ? '' : voxelDeclarations}${SAMPLING}${mode === 'uniform' ? UNIFORM_NOISE : ''}${mode === 'sh' ? '' : VOXEL_TEXT}${SCREEN_TEXT}
${gatherText(gather)}
@compute @workgroup_size(${HAIR_NODE_GROUP_SIZE}) fn ${HAIR_ENV_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let index=flatIndex(id,groups,${HAIR_NODE_GROUP_SIZE}u);
 let total=hairCounter[${HAIR_NODE_COUNTER_STORED}];
 if(index>=total){return;}
 let side=u32(ceil(sqrt(f32(total))));
 let at=vec2i(i32(index%side),i32(index/side));
 let strand=hairSampleOf(index);
 var light=vec3f(0.0);
 if(strand.scatter<0.5){
  let P=worldAt(vec2f(strand.pixel)+vec2f(0.5),strand.z);
  let Pt=P-view.display.yzw;
  let V=viewToEye(P);
  let T=strand.tangent;
${mode === 'sh' ? SH_TEXT : mode === 'adhoc' ? ADHOC_TEXT : UNIFORM_TEXT}
 }
 textureStore(hairEnvOut,at,vec4f(max(light,vec3f(0.0))*strand.coverage,strand.coverage));
}`,
  )

/** The kernel of the sky gather as a program of its own (the pass that lights the strands where no probe is cast): its resources in group 2, the reflection group in group 1. */
export const hairEnvSkyProgram = (mode: HairEnvironmentMode) =>
  wgslProgram('', [hairEnvKernel(mode, 'sky')])
