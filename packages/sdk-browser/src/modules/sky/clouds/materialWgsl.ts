import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import {
  type CLOUD_MATERIAL_RULES,
  type CloudMaterial,
} from '../../../../../sdk-core/src/modules/sky/cloudMaterial.ts'

/**
 * THE CLOUD MATERIAL, as the marcher reads it: at a point of the cloud layer, how much light the
 * cloud takes out of a ray (its extinction), the colour it scatters, how much of the sky light
 * it keeps, what it emits, and the density that tells the marcher an empty stretch from a full
 * one.
 *
 * The coverage comes from the pattern texture read over the layout tile, one channel to a cloud
 * type, each type's height profile from the profile texture read at the point's altitude in the
 * layer and that coverage. Two reads of the noise volume erode it: the distortion noise bends the
 * erosion noise's coordinates, more toward the top of the layer, and the erosion noise, less the
 * coverage bias, is added to the profile. The extinction is the density per metre times the
 * coverage and that sum, faded in over the first 500 m from the eye and cut in the outer 2 % of
 * the layer at its bottom and its top. The albedo and the occlusion are the material's own.
 *
 * Lengths are centimetres, as the marcher traces. The point's altitude is its normalised altitude
 * in the layer: 0 at the bottom, 1 at the top. A program that includes it declares, with
 * `cloudMaterialBindings`, the material block, the noise volume, the pattern, the profile, the mask and the lightning volume, and one sampler
 * that repeats. The noise and the profile are read at their first level, the lightning's fill at
 * the level the material names. The pattern, the mask and the lightning's core are read at the
 * level of the screen footprint of the sample: the position's derivative along a pixel to the right
 * and one below (`cloudDdx`, `cloudDdy`, centimetres), carried through the linear map from the
 * position to each texture's coordinates; a program that sets none (the shadow maps) reads their
 * first level.
 */

/** The material block's slots, each a `vec4f` of the settings it holds, in order: the one layout
 *  of the block, shared by its structure and by `packCloudMaterial`. The marcher's phase and
 *  multiple scattering are in it for the marcher to read; the material does not. */
const CLOUD_MATERIAL_SLOTS = {
  coverageDensity: ['layoutRepeatKm', 'coverageBias', 'densityPerMetre'],
  placement: ['placement'],
  typeWeights: ['typeWeights'],
  typePatternScale: ['typePatternScale'],
  maskTypeWeights: ['maskTypeWeights'],
  wind: ['wind'],
  erosionNoise: ['erosionNoise'],
  distortionNoise: ['distortionNoise'],
  noiseBias: ['noiseBias'],
  noiseStrength: ['noiseStrength'],
  detailNoise: ['detailNoise'],
  detailNoiseMultiplier: ['detailNoiseMultiplier'],
  albedoOcclusion: ['albedo', 'ambientOcclusion'],
  stormAlbedo: ['stormAlbedo', 'stormOcclusionFactor'],
  storm: ['stormAmount', 'lightningTextureScale', 'thirdNoise'],
  lightningColor: ['lightningColor'],
  lightningSource: ['lightningSource'],
  lightningMasks: ['lightningMasks'],
  lightningAnimation: ['lightningAnimation'],
  phase: ['phaseForwardAnisotropy', 'phaseSecondAnisotropy', 'phaseBlend'],
  multiScatter: [
    'multiScatterContribution',
    'multiScatterOcclusion',
    'multiScatterEccentricity',
    'multiScatterOctaves',
  ],
  ground: ['groundContribution'],
} as const satisfies Readonly<Record<string, readonly (keyof typeof CLOUD_MATERIAL_RULES)[]>>

const SLOTS = Object.entries(CLOUD_MATERIAL_SLOTS) as [string, readonly (keyof CloudMaterial)[]][]
/** The floats of the material block. */
export const CLOUD_MATERIAL_FLOATS = SLOTS.length * 4

/** The resolved material settings (`resolveCloudPart`) as the block the shader declares, into
 *  `out` (`CLOUD_MATERIAL_FLOATS` floats): each slot its settings one after the other, the rest of
 *  its four floats zero. */
export function packCloudMaterial(out: Float32Array, material: CloudMaterial) {
  out.fill(0, 0, CLOUD_MATERIAL_FLOATS)
  SLOTS.forEach(([, fields], slot) => {
    let next = slot * 4
    for (const field of fields) {
      const value = material[field]
      if (typeof value === 'object') for (const part of value) out[next++] = part
      else out[next++] = Number(value)
    }
  })
  return out
}

/** The declarations a program makes for the material, from binding `first` of group `group` on:
 *  the block (`cloudMaterial`), the noise volume, the layout pattern, the height profile, the
 *  layout mask, the lightning volume, and the sampler (`cloudSampler`). */
export const cloudMaterialBindings = (group: number, first: number) => `
@group(${group}) @binding(${first}) var<uniform> cloudMaterial:CloudMaterialBlock;
@group(${group}) @binding(${first + 1}) var noiseVolume:texture_3d<f32>;
@group(${group}) @binding(${first + 2}) var layoutPattern:texture_2d<f32>;
@group(${group}) @binding(${first + 3}) var heightProfile:texture_2d<f32>;
@group(${group}) @binding(${first + 4}) var globalMask:texture_2d<f32>;
@group(${group}) @binding(${first + 5}) var lightningVolume:texture_3d<f32>;
@group(${group}) @binding(${first + 6}) var cloudSampler:sampler;`

/** The layout entries of `cloudMaterialBindings` from binding `first`, in its order: the block, the
 *  noise volume, the pattern, the profile, the mask, the lightning volume, the sampler. */
export const cloudMaterialLayoutEntries = (first: number): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(first),
  computeTextureEntry(first + 1, 'float', '3d'),
  computeTextureEntry(first + 2, 'float'),
  computeTextureEntry(first + 3, 'float'),
  computeTextureEntry(first + 4, 'float'),
  computeTextureEntry(first + 5, 'float', '3d'),
  computeSamplerEntry(first + 6),
]

/** The material's empty-space output, `cloudMaterialEmptySpace(rel: vec3f, radius: f32) -> f32`: above
 *  zero where the froxel of bounding radius `radius` around the point `rel` (centimetres from the
 *  origin) may hold cloud, zero where it holds none. The built-in material leaves it unconnected,
 *  and an unconnected output says "matter is there", 1: no froxel is skipped, the table holds the
 *  start of the first slice, moved by the slice bias. It reads no texture. */
export const CLOUD_MATERIAL_EMPTY_SPACE_WGSL = wgslFn(
  'cloudMaterialEmptySpace',
  [],
  'fn cloudMaterialEmptySpace(rel:vec3f,radius:f32)->f32{return 1.0;}',
)

export const CLOUD_MATERIAL_WGSL = wgslBlock(
  'CLOUD_MATERIAL_WGSL',
  [],
  `
struct CloudMaterialBlock{${SLOTS.map(([slot]) => `${slot}:vec4f,`).join('')}}
const CM_PER_KM:f32=100000.0;
const CLOUD_CM_TO_KM:f32=0.00001;
const CLOUD_CM_TO_M:f32=0.01;
const CLOUD_M_TO_CM:f32=100.0;
const CLOUD_M_TO_KM:f32=0.001;
/** The share of the altitude, at the layer's bottom and top, where no cloud draws, and the floor
 *  of the warp that bends the erosion's coordinates. */
const CLOUD_EDGE_CUT:f32=0.02;
const CLOUD_WARP_FLOOR:f32=0.05;
/** The distance from the eye, in centimetres, over which a cloud fades in. */
const CLOUD_NEAR_FADE:f32=50000.0;
/** The most the emissive pin passes. */
const CLOUD_EMISSIVE_MOST:f32=65000.0;
/** The density a full storm adds per metre. */
const CLOUD_STORM_DENSITY:f32=0.666667;
var<private> cloudLayoutTileCm:f32;
var<private> cloudTurn:vec2f;
var<private> cloudDrift:vec3f;
/** How far the sample's position moves for a pixel to the right and one below, in the material's
 *  axes (the third the height), centimetres; zero until the march sets them. */
var<private> cloudDdx:vec3f;
var<private> cloudDdy:vec3f;
/** What does not change along a thread's march, once for the thread at \`time\`: the layout tile in
 *  centimetres, the cosine and the sine of the placement's turn, and what the wind has carried the
 *  noise by (the pattern's width in texels over the tile in kilometres sets the rate). */
fn cloudMaterialStart(time:f32){
 let m=cloudMaterial;
 cloudLayoutTileCm=m.coverageDensity.x*CM_PER_KM;
 cloudTurn=vec2f(cos(m.placement.w),sin(m.placement.w));
 let tile=f32(textureDimensions(layoutPattern,0).x)/m.coverageDensity.x*1000.0;
 cloudDrift=m.wind.xyz*m.wind.w*(time/tile);
}
/** The layout's texture coordinates' change for \`d\`, a change of the position: the position over
 *  the tile, turned by the placement. */
fn cloudLayoutGrad(d:vec3f)->vec2f{
 let t=d.xy/cloudLayoutTileCm;
 return vec2f(cloudTurn.x*t.x-cloudTurn.y*t.y,cloudTurn.y*t.x+cloudTurn.x*t.y);
}
struct CloudSample{extinction:vec3f,albedo:vec3f,ambientOcclusion:f32,emissive:vec3f,}
/** What a storm cloud emits, lit by a flash where the pattern's storm channel is high: the flash
 *  times the cloud's density, blended toward the conservative one, times the lightning colour and
 *  the extinction's own falloff, by the storm amount. */
fn cloudStormEmissive(l:CloudSite,time:f32,perMetre:f32,coverage:f32,extinction:f32)->vec3f{
 let m=cloudMaterial;
 let lightMask=saturate((l.pattern.w-m.lightningMasks.x)*m.lightningMasks.y);
 let lit=lightMask*mix(perMetre,coverage,m.lightningMasks.z);
 let flash=m.lightningColor.rgb*m.lightningColor.w*(pow(4.0,-extinction)*extinction);
 return cloudLightning(l,time)*lit*flash*m.storm.x;
}
/** The light of a lightning flash at the site \`l\`: the volume read at its finest level and again at
 *  the second level, the core raised to its power, the scatter and the fill added, over their sum. */
fn cloudLightning(l:CloudSite,time:f32)->f32{
 let m=cloudMaterial;
 let base=m.typePatternScale.w*l.place*m.storm.y;
 let flicker=base*sin(time*6.283185307)*0.001*m.lightningAnimation.x;
 let spot=vec3f((base+flicker).xy,time*m.lightningAnimation.y+m.lightningAnimation.z);
 let slope=m.typePatternScale.w*m.storm.y*(1.0+sin(time*6.283185307)*0.001*m.lightningAnimation.x);
 let gx=vec3f(l.gx*slope,0.0);
 let gy=vec3f(l.gy*slope,0.0);
 let core=textureSampleGrad(lightningVolume,cloudSampler,spot,gx,gy).r;
 let fill=textureSampleLevel(lightningVolume,cloudSampler,spot,m.lightningSource.w).r;
 let source=m.lightningSource;
 return (pow(core,source.x)+core*core*source.y+source.z*fill)/(source.y+source.z+1.0);
}
/** Where a point stands on the layout, the four channels of the pattern read there and the layout's
 *  texture coordinates' change for a pixel to the right and one below (\`gx\`, \`gy\`): what the
 *  conservative density is worked out from, and what the rest of the material starts from. */
struct CloudSite{place:vec3f,pattern:vec4f,gx:vec2f,gy:vec2f,}
/** The layout at \`world\`, the point's absolute position: its place over the tile, turned and
 *  shifted, and the pattern read there at the level of the sample's screen footprint. */
fn cloudSiteAt(world:vec3f)->CloudSite{
 let m=cloudMaterial;
 let shifted=world/cloudLayoutTileCm+vec3f(0.5,0.5,0.0);
 let around=shifted.xy-0.5;
 let layoutXY=0.5+vec2f(cloudTurn.x*around.x-cloudTurn.y*around.y,cloudTurn.y*around.x+cloudTurn.x*around.y);
 var l:CloudSite;
 l.place=vec3f(layoutXY,shifted.z)-m.placement.xyz;
 let patternXY=(l.place-0.5).xy;
 let scale=m.typePatternScale;
 l.gx=cloudLayoutGrad(cloudDdx);
 l.gy=cloudLayoutGrad(cloudDdy);
 l.pattern=vec4f(
  textureSampleGrad(layoutPattern,cloudSampler,patternXY*scale.x,l.gx*scale.x,l.gy*scale.x).r,
  textureSampleGrad(layoutPattern,cloudSampler,patternXY*scale.y,l.gx*scale.y,l.gy*scale.y).g,
  textureSampleGrad(layoutPattern,cloudSampler,patternXY*scale.z,l.gx*scale.z,l.gy*scale.z).b,
  textureSampleGrad(layoutPattern,cloudSampler,patternXY*scale.w,l.gx*scale.w,l.gy*scale.w).a);
 return l;
}
/** The coverage of the plain cloud types at the layout: the greatest of their weighted channels. */
fn cloudCoverage(l:CloudSite)->f32{
 let weighted=l.pattern.xyz*cloudMaterial.typeWeights.xyz;
 return max(max(weighted.x,weighted.y),weighted.z);
}
/** The material's conservative density at the layout: above 0 where a medium may be present, the
 *  coverage blended into the storm's by the storm amount. A marcher reads it before the rest of
 *  the material and skips the point where it is not above 0. */
fn cloudConservativeDensity(l:CloudSite)->f32{
 let coverage=cloudCoverage(l);
 return mix(coverage,max(coverage,l.pattern.w),cloudMaterial.storm.x);
}
/** The material at the point whose layout is \`l\` (\`cloudSiteAt\`), \`cameraRelative\` its
 *  position from the eye, \`altitude\` its normalised altitude in the layer, \`time\` in seconds.
 *  The density is (coverage, coverage, profile less one half, erosion), its first the conservative
 *  one. The storm amount blends the plain clouds into the storm ones; the third noise switch, a
 *  flag of the block, takes the detail noise into the erosion. The mask is read at the level of
 *  the sample's screen footprint (\`cloudDdx\`, \`cloudDdy\`). */
fn cloudMaterialAt(altitude:f32,cameraRelative:vec3f,time:f32,l:CloudSite)->CloudSample{
 let m=cloudMaterial;
 let storm=m.storm.x;
 let place=l.place;
 let pattern=l.pattern;
 let maskXY=(place+m.placement.xyz).xy;
 let coverage=cloudCoverage(l);
 let profile=m.typeWeights.xyz*vec3f(
  textureSampleLevel(heightProfile,cloudSampler,vec2f(altitude,pattern.x),0.0).r,
  textureSampleLevel(heightProfile,cloudSampler,vec2f(altitude,pattern.y),0.0).g,
  textureSampleLevel(heightProfile,cloudSampler,vec2f(altitude,pattern.z),0.0).b);
 let stormProfile=m.typeWeights.w*textureSampleLevel(heightProfile,cloudSampler,vec2f(altitude,pattern.w),0.0).a;
 let profileLess=mix(max(max(profile.x,profile.y),profile.z),stormProfile,storm)-0.5;
 let drift=cloudDrift;
 let erosionAt=m.erosionNoise.xyz*place+m.erosionNoise.w*drift;
 let distortionAt=m.distortionNoise.xyz*place+m.distortionNoise.w*drift;
 let distortionStrength=mix(m.noiseStrength.y,m.noiseStrength.y*m.noiseStrength.w,storm);
 let distortion=(textureSampleLevel(noiseVolume,cloudSampler,distortionAt,0.0).x-m.noiseBias.y)*distortionStrength;
 let lifted=altitude*(1.0-CLOUD_WARP_FLOOR)+CLOUD_WARP_FLOOR;
 let edge=2.0*abs(lifted-0.5);
 let bent=erosionAt+vec3f(lifted,lifted,edge*edge)*distortion;
 var erosion=(textureSampleLevel(noiseVolume,cloudSampler,bent,0.0).y-m.noiseBias.x+m.coverageDensity.y)*m.noiseStrength.x;
 if(m.storm.z>0.5){
  let detailAt=m.detailNoise.xyz*place+m.detailNoise.w*drift;
  let detail=textureSampleLevel(noiseVolume,cloudSampler,detailAt,0.0).xyz;
  let modulation=mix(dot(m.detailNoiseMultiplier.xyz,detail),detail.y,storm)*m.detailNoiseMultiplier.w;
  erosion=erosion*modulation+m.noiseStrength.z*(m.coverageDensity.y+detail.z-m.noiseBias.z);
 }
 let density=vec4f(cloudConservativeDensity(l),mix(coverage,pattern.w,storm),profileLess,erosion);
 let mask=textureSampleGrad(globalMask,cloudSampler,maskXY,l.gx,l.gy).rgb;
 let masked=dot(m.maskTypeWeights.xyz,mask*m.typeWeights.xyz)*m.maskTypeWeights.w*0.01;
 let perUnit=mix(m.coverageDensity.z,m.coverageDensity.z+CLOUD_STORM_DENSITY*storm,storm);
 let perMetre=(masked+density.y*(density.z+density.w))*perUnit;
 let inside=select(0.0,1.0,abs(altitude-0.5)<=0.5-CLOUD_EDGE_CUT);
 let fade=saturate(length(cameraRelative)/CLOUD_NEAR_FADE);
 let extinction=saturate(inside*perMetre*fade);
 var result:CloudSample;
 result.extinction=vec3f(extinction);
 result.albedo=mix(m.albedoOcclusion.xyz,m.stormAlbedo.xyz,(1.0-extinction*extinction*extinction)*storm);
 result.ambientOcclusion=mix(m.albedoOcclusion.w,m.stormAlbedo.w*m.albedoOcclusion.w,storm);
 // Without storm the lightning is lerped to nothing: skip its two volume reads, the result is the same.
 result.emissive=vec3f(0.0);
 if(storm>0.0){
  result.emissive=clamp(cloudStormEmissive(l,time,perMetre,density.x,extinction),vec3f(0.0),vec3f(CLOUD_EMISSIVE_MOST));
 }
 result.albedo=saturate(result.albedo);
 return result;
}`,
)
