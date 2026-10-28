import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { equalAreaEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import {
  bilinear3,
  fourRooksJitter,
  interleavedGradientNoise,
} from '../../../../../math/src/wgsl/sampling.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import {
  WORD_LIGHT_FORMAT,
  lightAtlasSampleType,
  lightAtlasScalar,
  lightOfTexel,
  lightReadDeps,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { atlasEntry } from '../atlas.ts'
import { POOL_ADAPTIVE, POOL_SLOT } from '../pool/poolLayout.ts'
import { CACHE_WORDS_WGSL } from '../cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { SP_REFLECTION } from '../screen/commonWgsl.ts'
import { FIELD_MAP_BORDER } from './mapsWgsl.ts'

/** The formats the field's gather writes: the diffuse light and the rough specular of each pixel, a colour in three half floats and, in the fourth, whether the field answered (one) or the pixel lies past its levels (zero: the sky light is then the pixel's). */
export const FIELD_GATHER_FORMAT = 'rgba16float' as const

/** The bindings of the pixels' gather (`fieldGatherProgram`), in group 0: the field's levels' uniform and cell table, the image's normals and flags, the irradiance and occlusion atlases of the probes, the cache's final radiance atlas
 *  (read at its levels of detail for the rough specular) and the parameters, then the two outputs. The depth pyramid and the view are the reflection group, 1. */
export const FIELD_GATHER_BINDINGS = {
  grid: 0,
  table: 1,
  normals: 2,
  flags: 3,
  irradiance: 4,
  occlusion: 5,
  final: 6,
  params: 7,
  diffuse: 8,
  specular: 9,
  /** Whether each probe stands outside every surface, by its slot (`fieldProbeOutside`, written with the occlusion maps). */
  valid: 10,
  /** The adaptive probes of each entry, the interpolation misses the pixels count and the pool's slots (the offsets of the adaptive probes, the frame each was last read), written where the field places probes adaptively. */
  adaptive: 11,
  misses: 12,
  slots: 13,
} as const

/** The layout of the gather's group 0. */
export const fieldGatherEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => {
  const B = FIELD_GATHER_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.table),
    computeTextureEntry(B.normals, 'float'),
    computeTextureEntry(B.flags, 'uint'),
    computeTextureEntry(B.irradiance, 'unfilterable-float'),
    computeTextureEntry(B.occlusion, 'unfilterable-float'),
    computeTextureEntry(B.final, lightAtlasSampleType(light)),
    computeUniformEntry(B.params),
    computeStorageTextureEntry(B.diffuse, FIELD_GATHER_FORMAT),
    computeStorageTextureEntry(B.specular, FIELD_GATHER_FORMAT),
    computeBufferEntry(B.valid, 'read-only-storage'),
    computeBufferEntry(B.adaptive, 'read-only-storage'),
    computeBufferEntry(B.misses, 'storage'),
    computeBufferEntry(B.slots, 'storage'),
  ]
}

/** The words of the gather's parameters (`vec4f` ×3): `x` the texels a side of a probe's irradiance map, `y` of its occlusion map, `z` the reduction the gather runs at, `w` the image's frame index; then `x` the bias the occlusion is read
 *  at (a share of the cell, `irradianceFieldProbeOcclusionBias`), `y` the roughness past which a pixel's specular is its diffuse, `z` the texels a side of the radiance maps, `w` their levels of detail;
 *  then `x` whether the field places probes adaptively, `y` the mask of the tile of pixels one of which reports the interpolation misses and `zw` that pixel's place in the tile. */
export const FIELD_GATHER_PARAM_WORDS = 12

/** The weight a probe is never given less than, and the one under which the interpolation has failed (`MinWeight`, `* 8 * 1.5`). */
const MIN_WEIGHT = 0.0001

/** The declarations of the gather: the surface, the maps, the parameters, the outputs and the pool's buffers, and the constants of the pool's slots. */
const fieldGatherDeclarations = (light: LightAtlasFormat) => `${wgslConsts({ FIELD_MAP_BORDER })}
@group(0) @binding(${FIELD_GATHER_BINDINGS.normals}) var surfaceNormals:texture_2d<f32>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.flags}) var surfaceFlags:texture_2d<u32>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.irradiance}) var irradianceAtlas:texture_2d<f32>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.occlusion}) var occlusionAtlas:texture_2d<f32>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.final}) var finalAtlas:texture_2d<${lightAtlasScalar(light)}>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.params}) var<uniform> field:array<vec4f,3>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.diffuse}) var diffuseOut:texture_storage_2d<${FIELD_GATHER_FORMAT},write>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.specular}) var specularOut:texture_storage_2d<${FIELD_GATHER_FORMAT},write>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.valid}) var<storage,read> probeValid:array<u32>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.adaptive}) var<storage,read> adaptiveProbes:array<u32>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.misses}) var<storage,read_write> misses:array<atomic<u32>>;
@group(0) @binding(${FIELD_GATHER_BINDINGS.slots}) var<storage,read_write> poolSlots:array<u32>;
const FIELD_MIN_WEIGHT:f32=${MIN_WEIGHT};
${wgslConsts({ FIELD_SLOT_WORDS: POOL_SLOT.words, FIELD_SLOT_USED: POOL_SLOT.usedAt, FIELD_SLOT_OFFSET: POOL_SLOT.offset, FIELD_MAX_ADAPTIVE: POOL_ADAPTIVE.probes, FIELD_MISS_PRECISION: POOL_ADAPTIVE.precision })}`

/** The reads of the probes' maps: the irradiance and the occlusion along a direction, the radiance along a direction at a level of detail. */
const fieldMapReads = (
  light: LightAtlasFormat,
) => `/** The texel of the atlas of squares 'side' texels a side whose square the slot 'slot' is, at the unit coordinates 'uv' of the map inside its border, read bilinearly. */
fn fieldMapTexel(slot:u32,uv:vec2f,res:u32,at:u32)->vec2i{
 let side=res+2u*FIELD_MAP_BORDER;
 let q=uv*f32(res)+vec2f(f32(FIELD_MAP_BORDER))-vec2f(0.5);
 return vec2i(cacheTileOf(slot,side))+vec2i(floor(q))+vec2i(i32(at&1u),i32(at>>1u));
}
fn fieldIrradiance(slot:u32,direction:vec3f)->vec3f{
 let res=u32(field[0].x);
 let uv=equalAreaEncode(direction);
 let q=uv*f32(res)-vec2f(0.5);
 var taps=array<vec3f,4>();
 for(var i=0u;i<4u;i++){taps[i]=textureLoad(irradianceAtlas,fieldMapTexel(slot,uv,res,i),0).rgb;}
 return bilinear3(taps[0],taps[1],taps[2],taps[3],fract(q))*bounce.reach.w;
}
fn fieldOcclusion(slot:u32,direction:vec3f)->vec2f{
 let res=u32(field[0].y);
 let uv=equalAreaEncode(direction);
 let q=uv*f32(res)-vec2f(0.5);
 let f=fract(q);
 let a=textureLoad(occlusionAtlas,fieldMapTexel(slot,uv,res,0u),0).rg;
 let b=textureLoad(occlusionAtlas,fieldMapTexel(slot,uv,res,1u),0).rg;
 let c=textureLoad(occlusionAtlas,fieldMapTexel(slot,uv,res,2u),0).rg;
 let d=textureLoad(occlusionAtlas,fieldMapTexel(slot,uv,res,3u),0).rg;
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
/** The radiance of the probe in 'slot' along 'direction', at the level of detail 'mip' of its final map, bilinear, the two levels it lies between mixed. */
fn fieldRadianceLevel(slot:u32,uv:vec2f,res:u32,level:u32,border:u32)->vec3f{
 let side=(res+2u*border)>>level;
 let q=uv*f32(res>>level)+vec2f(f32(border>>level))-vec2f(0.5);
 let base=vec2i(cacheTileOf(slot,side))+vec2i(floor(q));
 var taps=array<vec3f,4>();
 for(var i=0u;i<4u;i++){taps[i]=${lightOfTexel(light, 'textureLoad(finalAtlas,base+vec2i(i32(i&1u),i32(i>>1u)),i32(level))')};}
 return bilinear3(taps[0],taps[1],taps[2],taps[3],fract(q))*bounce.reach.w;
}
fn fieldRadiance(slot:u32,direction:vec3f,mip:f32)->vec3f{
 let res=u32(field[1].z);
 let levels=u32(field[1].w);
 let border=1u<<(levels-1u);
 let uv=equalAreaEncode(direction);
 let low=u32(floor(mip));
 let near=fieldRadianceLevel(slot,uv,res,low,border);
 let high=min(low+1u,levels-1u);
 if(high==low||fract(mip)==0.0){return near;}
 return mix(near,fieldRadianceLevel(slot,uv,res,high,border),fract(mip));
}`

/** The weighing of a probe for a pixel and the miss counted where the interpolation found none. */
const FIELD_PROBE_WGSL = `struct FieldSum{irradiance:vec3f,reflection:vec3f,weight:f32,}
/** The probe in 'slot' at 'probePosition', weighed for the pixel at 'P' (normal 'N') read from 'S', added in square roots. */
fn fieldProbe(sum:FieldSum,slot:u32,probePosition:vec3f,P:vec3f,S:vec3f,N:vec3f,reflection:vec3f,mip:f32,trilinear:f32,withReflection:bool,adaptiveUsed:bool)->FieldSum{
 var out=sum;
 let toProbe=probePosition-S;
 let distance=length(toProbe);
 let wrap=(dot(normalize(probePosition-P),N)+1.0)*0.5;
 var weight=wrap*wrap+0.2;
 let mean=fieldOcclusion(slot-1u,normalize(-toProbe));
 var chebyshev=1.0;
 if(distance>mean.x){
  let variance=abs(mean.x*mean.x-mean.y);
  let visible=variance/max(variance+(distance-mean.x)*(distance-mean.x),1e-12);
  chebyshev=max(visible*visible*visible,0.0);
 }
 weight=max(weight*max(chebyshev,0.05),FIELD_MIN_WEIGHT);
 if(weight<0.2){weight*=weight*weight/0.04;}
 // A probe inside a surface (invalid) weighs a thousandth, never under the minimum (RWProbeValid).
 weight=max(weight*max(select(0.0,1.0,probeValid[slot-1u]!=0u),0.001),FIELD_MIN_WEIGHT)*trilinear;
 // An adaptive probe that weighs on the pixel the feedback tile picks is read: the pool keeps it (the frame it was last read).
 if(adaptiveUsed&&weight>FIELD_MIN_WEIGHT){poolSlots[(slot-1u)*FIELD_SLOT_WORDS+FIELD_SLOT_USED]=bounce.frame.z;}
 out.irradiance+=sqrt(max(fieldIrradiance(slot-1u,N),vec3f(0.0)))*weight;
 if(withReflection){out.reflection+=sqrt(max(fieldRadiance(slot-1u,reflection,mip),vec3f(0.0)))*weight;}
 out.weight+=weight;
 return out;
}
/** An interpolation that found no probe: the cell nearest the point counts the miss and sums the offset the point lies at from its probe, in the units of the precision, which the pool takes a probe at the mean of. */
fn fieldMiss(level:u32,S:vec3f,spacing:f32){
 let cell=vec3i(bounce.levels[level].base)+clamp(vec3i(floor(probeCoordFloat(level,S))),vec3i(0),vec3i(i32(bounce.counts.x)-1));
 if(cacheSlotOf(level,cell)==0u){return;}
 let entry=cellEntry(level,probeWrap(cell));
 let cells=bounce.counts.y*bounce.counts.z;
 let middle=f32(FIELD_MISS_PRECISION)*0.5;
 let ideal=vec3u(clamp(round((S-probePosition(cell,spacing))*(middle/spacing)+vec3f(middle)),vec3f(0.0),vec3f(middle*2.0)));
 atomicAdd(&misses[entry],1u);
 atomicAdd(&misses[cells+entry],ideal.x);
 atomicAdd(&misses[2u*cells+entry],ideal.y);
 atomicAdd(&misses[3u*cells+entry],ideal.z);
}`

/** The kernel, a thread a pixel of the image at the reduction. */
const FIELD_GATHER_KERNEL_WGSL = `@compute @workgroup_size(8,8)
fn fieldGather(@builtin(global_invocation_id) id:vec3u){
 let reduction=u32(field[0].z);
 let image=textureDimensions(surfaceNormals);
 let size=(image+vec2u(reduction-1u))/vec2u(reduction);
 if(any(id.xy>=size)){return;}
 let at=vec2i(id.xy);
 let pixel=min(id.xy*reduction+select(vec2u(0u),fourRooksJitter(id.xy,u32(field[0].w)),reduction>1u),image-vec2u(1u));
 let z=hizOpaqueDepth(vec2i(pixel));
 let normal=textureLoad(surfaceNormals,vec2i(pixel),0);
 if(z<=0.0||dot(normal.xyz,normal.xyz)<0.5){
  textureStore(diffuseOut,at,vec4f(0.0));
  textureStore(specularOut,at,vec4f(0.0));
  return;
 }
 let P=worldAt(vec2f(pixel)+vec2f(0.5),z);
 let N=normalize(normal.xyz);
 let rough=normal.a;
 let V=viewToEye(P);
 let dither=interleavedGradientNoise(vec2f(pixel),f32(u32(field[0].w)%8u));
 let cover=cacheCoverage(P,dither);
 let reflection=reflect(-V,N);
 let diffuseLerp=saturate((rough-field[1].y)/0.1+1.0);
 let adaptive=field[2].x!=0.0;
 // Only the pixel of each tile that the frame picks reports: its coordinate in the tile is the jitter.
 let feedback=adaptive&&all((id.xy&vec2u(u32(field[2].y)))==vec2u(u32(field[2].z),u32(field[2].w)));
 var diffuse=vec3f(0.0);
 var specular=vec3f(0.0);
 var answered=0.0;
 if(cover.valid){
  let spacing=bounce.levels[cover.level].spacing;
  let cameraDistance=sqrt(cameraDistanceSq(bounce.eye.xyz-P));
  let viewBias=mix(0.0,0.8,saturate(cameraDistance/spacing));
  let S=P+(N*0.2+V*viewBias)*(0.75*spacing*field[1].x);
  let coneHalfAngle=saturate(rough*0.8);
  let reach=max(sqrt(max(1.0-cos(coneHalfAngle),0.0))*field[1].z,1.0);
  let mip=clamp(log2(reach),0.0,f32(u32(field[1].w)-1u));
  let withReflection=diffuseLerp<1.0;
  let bottom=probeBottomCell(cover.level,S);
  let alpha=probeFraction(cover.level,S);
  var sum=FieldSum(vec3f(0.0),vec3f(0.0),0.0);
  for(var i=0u;i<8u;i++){
   let offset=vec3u((i&4u)>>2u,(i&2u)>>1u,i&1u);
   let cell=bottom+vec3i(offset);
   let slot=cacheSlotOf(cover.level,cell);
   if(slot==0u){continue;}
   let weights=max(select(vec3f(1.0)-alpha,alpha,offset>vec3u(0u)),vec3f(0.001));
   let trilinear=weights.x*weights.y*weights.z;
   sum=fieldProbe(sum,slot,probePosition(cell,spacing),P,S,N,reflection,mip,trilinear,withReflection,false);
   if(adaptive){
    let entry=cellEntry(cover.level,probeWrap(cell));
    for(var rank=0u;rank<FIELD_MAX_ADAPTIVE;rank++){
     let held=adaptiveProbes[entry*FIELD_MAX_ADAPTIVE+rank]>>16u;
     if(held==0u){continue;}
     let at=(held-1u)*FIELD_SLOT_WORDS+FIELD_SLOT_OFFSET;
     let shift=vec3f(bitcast<f32>(poolSlots[at]),bitcast<f32>(poolSlots[at+1u]),bitcast<f32>(poolSlots[at+2u]));
     sum=fieldProbe(sum,held,probePosition(cell,spacing)+shift,P,S,N,reflection,mip,trilinear,withReflection,feedback);
    }
   }
  }
  let inverse=1.0/max(sum.weight,FIELD_MIN_WEIGHT);
  let mean=sum.irradiance*inverse;
  let meanReflection=sum.reflection*inverse;
  diffuse=mean*mean;
  specular=mix(meanReflection*meanReflection,diffuse,diffuseLerp);
  answered=select(1.0,0.0,sum.weight<FIELD_MIN_WEIGHT*8.0*1.5);
  if(adaptive&&feedback&&answered==0.0){fieldMiss(cover.level,S,spacing);}
 }else{
  // Past the field's levels the pixel takes the sky light's: its diffuse light along the normal, its reflection along the reflected view, the rough share mixed as above
  // (GetIrradianceFieldInterpolatedLighting, IrradianceFieldInterpolation.ush:361-365).
  let sky=skyLightApplied();
  diffuse=select(vec3f(0.0),skyLightDiffuse(N),sky);
  specular=mix(select(vec3f(0.0),skyLightReflection(reflection,rough),sky),diffuse,diffuseLerp);
  answered=1.0;
 }
 textureStore(diffuseOut,at,vec4f(diffuse,answered));
 textureStore(specularOut,at,vec4f(specular,answered));
}`

/**
 * THE GATHER OF THE IRRADIANCE FIELD, a thread a pixel of the image at the reduction `z` (`GetIrradianceFieldInterpolatedLighting`, `InterpolateIrradianceProbesToPixelsCS`): the level of probes
 * that covers the pixel's point (`cacheCoverage`, chosen with the pixel's noise), and, from the point moved off the surface — along the normal (a fifth) and toward the eye (up to four fifths, the less the nearer the eye is than a cell),
 * by three quarters of a cell times `irradianceFieldProbeOcclusionBias` — the eight probes round it, each weighed: by its place trilinearly (never under a thousandth), by how much it faces the surface (the square of the half of one plus the
 * cosine, plus a fifth), by the Chebyshev bound that the point is not behind a surface of the probe's own map (the visibility the cube of its variance gives, never under a twentieth, the probe's own minimum
 * under it, a weight under a fifth crushed by its square over the fifth's), the weight of a probe inside a surface (its validity) a thousandth at most. A cell's adaptive probes weigh as its own does, at the cell's trilinear share. The irradiance of the probe along the normal
 * (its map read bilinearly at the normal's equal-area point) and, where the pixel's roughness asks it, the radiance along the reflection at the cone's level of detail, are averaged in square roots by the weights and squared back. A pixel past the
 * levels takes the sky light's; a pixel whose weights are all under the minimum's eight and a half answers none (alpha zero) and, where it is the pixel of its tile the frame picks, counts the miss for the nearest cell, which takes an adaptive probe once it counted enough (`fieldMiss`). The pixel's rough specular is its diffuse light by the share its roughness gives (`DiffuseLerp`).
 */
export const fieldGatherProgram = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) =>
  wgslProgram(
    [
      fieldGatherDeclarations(light),
      fieldMapReads(light),
      FIELD_PROBE_WGSL,
      FIELD_GATHER_KERNEL_WGSL,
    ].join('\n'),
    [
      SP_REFLECTION,
      WORLD_AT_WGSL,
      CACHE_WORDS_WGSL,
      bounceBindingsWgsl(0, FIELD_GATHER_BINDINGS.grid, FIELD_GATHER_BINDINGS.table),
      equalAreaEncode,
      fourRooksJitter,
      interleavedGradientNoise,
      ...lightReadDeps(light),
      bilinear3,
    ],
  )
