import { wgslConst, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'

/** The most samples a sampled pixel or voxel holds (the 2 by 2 layout). */
const SAMPLER_MAX_SAMPLES = 4
/** The index a sample holds when no light was drawn; limited by the packed sample's fifteen bits. */
export const NO_LIGHT_INDEX = 32767

/** The hash that maps a light index to the bits of a tile's visible and hidden light sets. */
export const hashLightIndex = wgslFn(
  'hashLightIndex',
  [],
  `fn hashLightIndex(input:u32)->u32{
var h=input+374761393u;
h=668265263u*((h<<17u)|(h>>15u));
h=2246822519u*(h^(h>>15u));
h=3266489917u*(h^(h>>13u));
return h^(h>>16u);
}`,
)

/** Whether a tile's visible set (four words) holds the light: the two bits its hash names are both set. */
export const isLightVisible = wgslFn(
  'isLightVisible',
  [hashLightIndex],
  `fn isLightVisible(bits:vec4<u32>,lightIndex:u32)->bool{
let h=hashLightIndex(lightIndex);
let w0=h&3u;let w1=(h>>2u)&3u;
let b0=1u<<((h>>4u)&31u);let b1=1u<<((h>>9u)&31u);
return (bits[w0]&b0)!=0u&&(bits[w1]&b1)!=0u;
}`,
)

/** Whether a tile's hidden set (two words) holds the light. */
export const isLightHidden = wgslFn(
  'isLightHidden',
  [hashLightIndex],
  `fn isLightHidden(bits:vec2<u32>,lightIndex:u32)->bool{
let h=hashLightIndex(lightIndex);
let w0=h&1u;let w1=(h>>1u)&1u;
let b0=1u<<((h>>2u)&31u);let b1=1u<<((h>>7u)&31u);
return (bits[w0]&b0)!=0u&&(bits[w1]&b1)!=0u;
}`,
)

/** Packs a candidate sample: the light's index in the low fifteen bits, its weight as a half float's low fifteen bits
 *  above, and whether the light was visible last image in the top bit. */
const packCandidate = wgslFn(
  'packCandidate',
  [],
  `fn packCandidate(lightIndex:u32,visible:bool,weight:f32)->u32{
let w=pack2x16float(vec2<f32>(weight,0.0))&0x7FFFu;
return (lightIndex&0x7FFFu)|(w<<16u)|select(0u,0x80000000u,visible);
}`,
)

/** The light index, visibility and weight a packed candidate holds. */
export const candidateIndex = wgslFn(
  'candidateIndex',
  [],
  `fn candidateIndex(p:u32)->u32{return p&0xFFFFu;}`,
)
export const candidateVisible = wgslFn(
  'candidateVisible',
  [],
  `fn candidateVisible(p:u32)->bool{return (p&0x80000000u)!=0u;}`,
)
export const candidateWeight = wgslFn(
  'candidateWeight',
  [],
  `fn candidateWeight(p:u32)->f32{return unpack2x16float((p>>16u)&0x7FFFu).x;}`,
)

/** The state of a pixel's or voxel's light sampling: the packed candidates, the random number each one will use to pick
 *  its light, and the sum of the weights offered. */
const lightSamplerStruct = wgslStruct(
  'LightSampler',
  [],
  `struct LightSampler{packed:array<u32,${SAMPLER_MAX_SAMPLES}>,random:array<f32,${SAMPLER_MAX_SAMPLES}>,weightSum:f32,}`,
)

const noLightCandidate = wgslConst(
  'NO_LIGHT_CANDIDATE',
  [],
  `const NO_LIGHT_CANDIDATE:u32=${NO_LIGHT_INDEX}u|0x80000000u;`,
)

/** A sampler whose `count` samples draw with the stratified numbers `(random+i)/count`. */
export const initLightSamplerStratified = wgslFn(
  'initLightSamplerStratified',
  [lightSamplerStruct, noLightCandidate],
  `fn initLightSamplerStratified(random:f32,count:u32)->LightSampler{
var s:LightSampler;
s.weightSum=0.0;
for(var i=0u;i<${SAMPLER_MAX_SAMPLES}u;i++){
s.packed[i]=NO_LIGHT_CANDIDATE;
s.random[i]=select(0.0,(random+f32(i))/f32(count),i<count);
}
return s;
}`,
)

/** Offers one light to the sampler: each sample keeps the light with the chance its weight holds of the weights seen
 *  (a weighted reservoir with one slot, its random number rescaled to stay uniform). A light that is not radial cannot
 *  take more of the budget than `directionalRatio` of what was offered before it, when the ratio is above 0. */
export const addLightSample = wgslFn(
  'addLightSample',
  [lightSamplerStruct, packCandidate],
  `fn addLightSample(s:ptr<function,LightSampler>,weightIn:f32,lightIndex:u32,visible:bool,radial:bool,count:u32,directionalRatio:f32,directionalMinWeight:f32){
var weight=weightIn;
if(!radial&&directionalRatio>0.0){weight=min(weight,max((*s).weightSum,directionalMinWeight)*directionalRatio);}
let tau=(*s).weightSum/((*s).weightSum+weight);
(*s).weightSum+=weight;
for(var i=0u;i<count;i++){
var r=(*s).random[i];
if(r<tau){r=r/tau;}else{r=(r-tau)/(1.0-tau);(*s).packed[i]=packCandidate(lightIndex,visible,weight);}
(*s).random[i]=clamp(r,0.0,0.9999);
}
}`,
)

/** Estimated light reaching a point from a local light: power times the radius mask and falloff, scaled by the exposure. */
export const estimateLocalLight = wgslFn(
  'estimateLocalLight',
  [],
  `fn estimateLocalLight(distanceSquared:f32,power:f32,invRadius:f32,falloffExponent:f32,preExposure:f32)->f32{
let d2=max(distanceSquared,0.01);
let n=d2*invRadius*invRadius;
var falloff=1.0;
if(falloffExponent>0.0){falloff=pow(1.0-saturate(n),falloffExponent);}
else{let m=saturate(1.0-n*n);falloff=m*m/d2;}
return power*falloff*preExposure/3.14159265358979;
}`,
)

/** The mask that fades a weight out under `threshold`. */
export const smoothFalloffMask = wgslFn(
  'smoothFalloffMask',
  [],
  `fn smoothFalloffMask(x:f32,threshold:f32)->f32{
if(x>0.0){let r=threshold/x;let m=saturate(1.0-r*r*r*r);return m*m;}
return 1.0;
}`,
)

/** The weight a light has in the draw, from its luminance at the point: perceptual, so a strong hidden light does not
 *  take the budget. */
export const lightTargetWeight = wgslFn(
  'lightTargetWeight',
  [smoothFalloffMask],
  `fn lightTargetWeight(luminance:f32,minSampleWeight:f32)->f32{
return log2(luminance*smoothFalloffMask(luminance,minSampleWeight)+1.0);
}`,
)

/** A light sample, one word: the light's index (fifteen bits), whether its shadow is cast in the volume, its weight (a half float without its sign
 *  or its last mantissa bit, whose place the guide bit takes), whether the light was visible when the draw was guided, whether the ray is still
 *  to be traced as visible. */
export const packLightSample = wgslFn(
  'packLightSample',
  [],
  `fn packLightSample(index:u32,weight:f32,visible:bool,guided:bool,volumetric:bool)->u32{
return (index&0x7FFFu)|(select(0u,1u,volumetric)<<15u)|((pack2x16float(vec2<f32>(weight,0.0))&0x7FFEu)<<16u)|(select(0u,1u,guided)<<16u)|(select(0u,1u,visible)<<31u);
}`,
)
export const lightSampleIndex = wgslFn(
  'lightSampleIndex',
  [],
  `fn lightSampleIndex(p:u32)->u32{return p&0x7FFFu;}`,
)
export const lightSampleWeight = wgslFn(
  'lightSampleWeight',
  [],
  `fn lightSampleWeight(p:u32)->f32{return unpack2x16float((p>>16u)&0x7FFEu).x;}`,
)
export const lightSampleVisible = wgslFn(
  'lightSampleVisible',
  [],
  `fn lightSampleVisible(p:u32)->bool{return (p>>31u)!=0u;}`,
)
export const lightSampleGuided = wgslFn(
  'lightSampleGuided',
  [],
  `fn lightSampleGuided(p:u32)->bool{return ((p>>16u)&1u)!=0u;}`,
)
/** A sample with no light: what a pixel the lighting does not reach holds. */
export const noLightSample = wgslConst(
  'NO_LIGHT_SAMPLE',
  [],
  `const NO_LIGHT_SAMPLE:u32=${NO_LIGHT_INDEX | (1 << 15)}u;`,
)

/** The ray of a sample, one word: the distance it traversed (a half float's fifteen low bits), whether it is traced, its place on the light
 *  (six bits an axis), whether it is traced from a first person surface and its type (default, hair, two-sided, transmission). */
export const RAY_TYPE = { default: 0, hair: 1, twoSided: 2, transmission: 3 } as const
export const RAY_MAX_DISTANCE = 65504
export const packLightSampleRay = wgslFn(
  'packLightSampleRay',
  [],
  `fn packLightSampleRay(distance:f32,uv:vec2<f32>,rayType:u32,firstPerson:bool,completed:bool)->u32{
return (pack2x16float(vec2<f32>(distance,0.0))&0x7FFFu)|(select(0u,1u,completed)<<15u)|((u32(uv.x*63.0+0.5)&0x3Fu)<<16u)|((u32(uv.y*63.0+0.5)&0x3Fu)<<22u)|(select(0u,1u,firstPerson)<<28u)|((rayType&3u)<<30u);
}`,
)
export const lightSampleRayUv = wgslFn(
  'lightSampleRayUv',
  [],
  `fn lightSampleRayUv(p:u32)->vec2<f32>{return vec2<f32>(f32((p>>16u)&0x3Fu),f32((p>>22u)&0x3Fu))/63.0;}`,
)
export const lightSampleRayType = wgslFn(
  'lightSampleRayType',
  [],
  `fn lightSampleRayType(p:u32)->u32{return p>>30u;}`,
)
export const lightSampleRayCompleted = wgslFn(
  'lightSampleRayCompleted',
  [],
  `fn lightSampleRayCompleted(p:u32)->bool{return ((p>>15u)&1u)!=0u;}`,
)
export const lightSampleRayDistance = wgslFn(
  'lightSampleRayDistance',
  [],
  `fn lightSampleRayDistance(p:u32)->f32{return unpack2x16float(p&0x7FFFu).x;}`,
)
/** A ray with nothing to trace: its centre, the default type, completed. */
export const noLightRay = wgslConst(
  'NO_LIGHT_RAY',
  [],
  `const NO_LIGHT_RAY:u32=${(0x8000 | (32 << 16) | (32 << 22)) >>> 0}u;`,
)

/** The tile coordinates a word holds, `x | y << 16`. */
export const unpackTile = wgslFn(
  'unpackTile',
  [],
  `fn unpackTile(p:u32)->vec2<u32>{return vec2<u32>(p&0xFFFFu,p>>16u);}`,
)
