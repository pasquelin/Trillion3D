import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { blueNoiseWgsl } from '../gpu/noise/blueNoiseWgsl.ts'
import { interleavedGradientNoise, r2Sequence } from '../../../math/src/wgsl/sampling.ts'
import { pixelToNdc, transformHomogeneousPoint } from '../../../math/src/wgsl/projection.ts'
import { VOXEL_COMMON_WGSL } from './voxelWgsl.ts'
import { HAIR_VIEW_WGSL } from './ribbonWgsl.ts'
import { DEEP_SHADOW_FILTER_WGSL } from './deepShadowWgsl.ts'
import {
  HAIR_TRAVERSAL_MAX_DISTANCE,
  HAIR_VOXEL_JITTER_WGSL,
  voxelTraversalWgsl,
} from './voxelTraversalWgsl.ts'

/** The bindings of the pass (group 0). */
export const HAIR_SURFACE_SHADOW_BINDINGS = {
  params: 0,
  lights: 1,
  view: 2,
  sceneDepth: 3,
  hairDepth: 4,
  coverage: 5,
  voxelParams: 6,
  voxelNodes: 7,
  voxelPageIndex: 8,
  voxels: 9,
  viewInfos: 10,
  slotMaps: 11,
  frontDepth: 12,
  domLayers: 13,
  out: 14,
  blueNoise: 15,
  normals: 16,
} as const
/** The entry point of the kernel. */
export const HAIR_SURFACE_SHADOW_ENTRY = 'hairSurfaceShadow'
/** The words of the parameters block (`SurfaceParams`) and of a light's record (`SurfaceLight`). */
export const HAIR_SURFACE_PARAM_WORDS = 8
export const HAIR_SURFACE_LIGHT_WORDS = 20
/** What a light's record says of how the strands shade the surfaces for it. */
export const HAIR_SURFACE_KIND = { none: 0, deep: 1, voxel: 2 } as const
/** The format of the layers: the share of the light the strands let through. */
export const HAIR_SURFACE_SHADOW_FORMAT: GPUTextureFormat = 'rgba8unorm'

const B = HAIR_SURFACE_SHADOW_BINDINGS
const COVERAGE_THRESHOLD = 0.995

/**
 * THE SHADOW THE STRANDS CAST ON THE SURFACES, for the classic shadow mode: for each light (a layer) and each pixel that shows a surface, the share of the light the strands let through — read by
 * the projection of the shadows (`VSM_PROJECTION_BINDING.hairShadow`), which takes the least of it and the shadow map's. A light that has a deep shadow takes its filter on the depth the
 * strands left in the atlas (a 2x2, a 4x4, a Gaussian of 8 or of 16 taps, or a Gaussian of 8 taps on the hair count of the layers, `hairDeepShadowMaskKernelType`), the least over the slots
 * its macro groups were given, a pixel the strands cover whole left lit; another light (a shadow the strands cast with the voxels) the least over the macro groups of the hair on the way to the
 * light through the voxels, a pixel the strands nearly cover (0.995 of it) left out. A light the strands do not shade leaves 1.
 */
export const hairSurfaceShadowWgsl = wgslProgram(
  `struct DeepViewInfo{toClipScaledBiased:mat4x4f,toClip:mat4x4f,atlasScaleBias:vec4f,viewForward:vec3f,minRadius:f32}
struct SurfaceLight{
 position:vec4f,
 layerDepths:vec4f,
 kind:u32,slotMapAt:u32,kernelType:u32,atlas:u32,
 depthBiasScale:f32,densityScale:f32,aperture:f32,fade:f32,
 range:f32,pad0:f32,pad1:f32,pad2:f32}
struct SurfaceParams{count:u32,frame:u32,jitterMode:u32,randomType:u32,density:f32,depthBias:f32,stepping:f32,pad0:f32}
@group(0) @binding(${B.params}) var<uniform> surface:SurfaceParams;
@group(0) @binding(${B.lights}) var<storage,read> lights:array<SurfaceLight>;
@group(0) @binding(${B.view}) var<uniform> view:HairView;
@group(0) @binding(${B.sceneDepth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${B.hairDepth}) var hairDepth:texture_2d<f32>;
@group(0) @binding(${B.coverage}) var coverage:texture_2d<f32>;
@group(0) @binding(${B.voxelParams}) var<uniform> params:VoxelParams;
@group(0) @binding(${B.voxelNodes}) var<storage,read> nodes:array<u32>;
@group(0) @binding(${B.voxelPageIndex}) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(${B.voxels}) var<storage,read> voxels:array<u32>;
@group(0) @binding(${B.viewInfos}) var<storage,read> viewInfos:array<DeepViewInfo>;
@group(0) @binding(${B.slotMaps}) var<storage,read> slotMaps:array<u32>;
@group(0) @binding(${B.frontDepth}) var frontDepth:texture_depth_2d;
@group(0) @binding(${B.domLayers}) var domLayers:texture_2d<f32>;
@group(0) @binding(${B.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${B.out}) var shadowOut:texture_storage_2d_array<rgba8unorm,write>;
// Whether the light-space depth \`z\` is behind the nearest strand at the texel \`c\` of the atlas (reverse depth: the nearer is the greater).
fn occluded(c:vec2i,z:f32)->f32{return select(0.0,1.0,z<textureLoad(frontDepth,clamp(c,vec2i(0),vec2i(textureDimensions(frontDepth))-vec2i(1)),0));}
fn rowOfThree(first:vec2i,z:f32)->vec3f{return vec3f(occluded(first,z),occluded(first+vec2i(1,0),z),occluded(first+vec2i(2,0),z));}
fn rowOfFour(first:vec2i,z:f32)->vec4f{return vec4f(occluded(first,z),occluded(first+vec2i(1,0),z),occluded(first+vec2i(2,0),z),occluded(first+vec2i(3,0),z));}
fn pcf2x2(texel:vec2f,z:f32)->f32{
 let fraction=fract(texel);
 let first=vec2i(floor(texel)-vec2f(1.0));
 let a=rowOfThree(first,z);
 let b=rowOfThree(first+vec2i(0,1),z);
 let c=rowOfThree(first+vec2i(0,2),z);
 let r=vec3f(a.x*(1.0-fraction.x)+a.y+a.z*fraction.x,b.x*(1.0-fraction.x)+b.y+b.z*fraction.x,c.x*(1.0-fraction.x)+c.y+c.z*fraction.x);
 return saturate(0.25*dot(r,vec3f(1.0-fraction.y,1.0,fraction.y)));
}
fn pcf4x4(texel:vec2f,z:f32)->f32{
 let shifted=texel-vec2f(0.5);
 let fraction=fract(shifted);
 let first=vec2i(floor(shifted)-vec2f(1.0));
 var r=vec4f(0.0);
 for(var row=0;row<4;row++){
  let v=rowOfFour(first+vec2i(0,row),z);
  r[row]=v.x*(1.0-fraction.x)+v.y+v.z+v.w*fraction.x;
 }
 return saturate(dot(r,vec4f(1.0-fraction.y,1.0,1.0,fraction.y))/9.0);
}
fn gaussian(texel:vec2f,z:f32,taps:u32,radius:f32)->f32{
 var acc=0.0;
 for(var k=0u;k<taps;k++){acc+=pcf2x2(texel+DISC[k]*radius,z);}
 return acc/f32(taps);
}
fn gaussianCount(position:vec3f,light:SurfaceLight,radius:f32)->f32{
 let bias=light.layerDepths.x*light.depthBiasScale;
 var acc=0.0;
 for(var k=0u;k<8u;k++){acc+=saturate(sampleBilinear(position+vec3f(DISC[k]*radius,0.0),bias,light.layerDepths));}
 return acc/8.0;
}
// The deep shadows of the light: the least visibility over the slots of its macro groups.
fn deepVisibility(light:SurfaceLight,world:vec3f)->f32{
 var visible=1.0;
 for(var owner=0u;owner<16u;owner++){
  let slot=slotMaps[light.slotMapAt+owner];
  if(slot==0xFFFFFFFFu){continue;}
  let info=viewInfos[slot];
  let clip=info.toClip*vec4f(world,1.0);
  let ndc=clip.xyz/clip.w;
  let uv=vec2f((ndc.x+1.0)*0.5,1.0-(ndc.y+1.0)*0.5);
  if(!(clip.w>0.0&&uv.x>=0.0&&uv.x<=1.0&&uv.y>=0.0&&uv.y<=1.0)){continue;}
  let atlas=f32(light.atlas);
  let scaleBias=info.atlasScaleBias*vec4f(atlas,atlas,atlas,atlas);
  let texel=uv*scaleBias.xy+scaleBias.zw;
  let z=saturate(ndc.z);
  var share=0.0;
  if(light.kernelType==1u){share=pcf4x4(texel,z);}
  else if(light.kernelType==2u){share=gaussian(texel,z,8u,3.0);}
  else if(light.kernelType==3u){share=gaussian(texel,z,16u,3.0);}
  else if(light.kernelType==4u){share=gaussianCount(vec3f(texel,ndc.z),light,3.0);}
  else{share=pcf2x2(texel,z);}
  visible=min(visible,1.0-share);
 }
 return visible;
}
// The jitter of a ray, by the type the settings choose.
fn rayRandom(pixel:vec2u)->vec3f{
 if(surface.randomType==0u){return hairVoxelJitter(pixel,0u,surface.frame,surface.jitterMode);}
 if(surface.randomType==1u){
  if(surface.jitterMode==0u){return vec3f(0.0);}
  let seed=f32(select(surface.frame%8u,0u,surface.jitterMode>1u));
  let first=interleavedGradientNoise(vec2f(pixel),seed);
  let second=interleavedGradientNoise(vec2f(pixel)+vec2f(17.0),seed);
  return vec3f(first,first,second);
 }
 let size=vec2f(BLUE_NOISE_TILE.xy);
 let time=surface.frame%8u;
 return vec3f(blueNoiseVec2(pixel+vec2u(r2Sequence(0u)*size),time),blueNoiseVec2(pixel+vec2u(r2Sequence(1u)*size),time).x);
}
// The voxels' shadow of the light: the least over the macro groups of what the hair on the way lets through.
fn voxelVisibility(light:SurfaceLight,world:vec3f,toLight:vec3f,pixel:vec2u)->f32{
 let farPoint=select(light.position.xyz,world+toLight*${HAIR_TRAVERSAL_MAX_DISTANCE}.0,light.position.w==0.0);
 let random=rayRandom(pixel);
 let bias=surface.depthBias*toLight+0.5*(random*2.0-vec3f(1.0));
 var visible=1.0;
 for(var member=0u;member<params.macroGroupCount;member++){
  let node=nodeOf(member);
  if(any(node.pages==vec3u(0u))){continue;}
  let traced=traceVoxels(world+bias*node.size,farPoint,node,TraversalSettings(surface.density,1.0,${HAIR_TRAVERSAL_MAX_DISTANCE}.0,surface.stepping,random,0.0,true,true));
  visible=min(visible,saturate(1.0-traced.hairCount));
 }
 return visible;
}
@compute @workgroup_size(8,8,1) fn ${HAIR_SURFACE_SHADOW_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let layer=id.z;
 let size=vec2u(textureDimensions(sceneDepth));
 if(id.x>=size.x||id.y>=size.y||layer>=surface.count){return;}
 let pixel=id.xy;
 let z=textureLoad(sceneDepth,vec2i(pixel),0);
 var share=1.0;
 let light=lights[layer];
 if(z>0.0&&light.kind!=${HAIR_SURFACE_KIND.none}u){
  let strandDepth=textureLoad(hairDepth,vec2i(pixel),0).x;
  let strandCovered=strandDepth>0.0;
  let held=select(0.0,textureLoad(coverage,vec2i(pixel),0).x,strandCovered);
  let h=transformHomogeneousPoint(view.inverseViewProj,vec3f(pixelToNdc(vec2f(pixel)+vec2f(0.5),view.size),z));
  let world=h.xyz/h.w;
  var visible=1.0;
  // The pixel the light does not reach (past its range, or turned from it) is left unmarched, as R leaves a pixel its mask says is not lit (RayMarchMask, HairStrandsDeepShadowMask.usf:511). The shadow maps' own share is not read: R hands its strands' pass the mask the maps already wrote (LightRendering.cpp:2288, copied to RayMarchMask at HairStrandsTransmittance.cpp:507-514), while here the projection kernel computes that share after this pass and takes the least of the two itself, so a pixel the maps shade is marched here and the result is the same.
  let toLight=select(normalize(light.position.xyz-world),-light.position.xyz,light.position.w==0.0);
  let reached=(light.position.w==0.0||light.range<=0.0||distance(world,light.position.xyz)<light.range)&&dot(textureLoad(normals,vec2i(pixel),0).xyz,toLight)>0.0;
  if(!reached){}
  else if(light.kind==${HAIR_SURFACE_KIND.deep}u){
    if(!(strandCovered&&held>=1.0)){visible=deepVisibility(light,world);}
  }else if(!strandCovered||held<${COVERAGE_THRESHOLD}){
    visible=voxelVisibility(light,world,toLight,pixel);
  }
  share=mix(1.0,visible,light.fade);
 }
 textureStore(shadowOut,vec2i(pixel),i32(layer),vec4f(share));
}`,
  [
    HAIR_VIEW_WGSL,
    VOXEL_COMMON_WGSL,
    voxelTraversalWgsl(true),
    HAIR_VOXEL_JITTER_WGSL,
    DEEP_SHADOW_FILTER_WGSL,
    blueNoiseWgsl(0, B.blueNoise),
    interleavedGradientNoise,
    r2Sequence,
    pixelToNdc,
    transformHomogeneousPoint,
  ],
)
