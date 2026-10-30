import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { vsmConsumerWgsl } from '../../../lighting/direct/vsmConsumerWgsl.ts'
import { directLightWgsl } from '../../../lighting/direct/lightWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../../../lighting/direct/lampSeenWgsl.ts'
import { lightStrengthWgsl } from '../../../lighting/direct/lightStrengthWgsl.ts'
import { TILE_SLICE_WGSL } from '../../../lighting/direct/lightingWgsl.ts'
import { vsmFragmentSampleWgsl } from '../../../lighting/direct/shadowTraceWgsl.ts'
import { VSM_TRACE_KINDS_SUN } from '../../../lighting/shadows/vsm/trace/traceWgsl.ts'
import { cloudShadowReadWgsl } from '../../../lighting/atmosphere/cloudShadowRead.ts'
import { VIEW_SLOT } from '../../../lighting/atmosphere/layout.ts'
import { skyLightDiffuseWgsl } from '../skyLight/read.ts'
import { CLOUD_MATERIAL_EMPTY_SPACE_WGSL } from './materialWgsl.ts'
import { CLOUD_POINT_WGSL } from './traceLightWgsl.ts'
import { CLOUD_EMPTY_SPACE_DIAGONAL, CLOUD_EMPTY_SPACE_SIDE } from './traceOptions.ts'
import {
  CLOUD_TRACE_EXTRA_BINDING as B,
  CLOUD_TRACE_EXTRA_GROUP as G,
  CLOUD_TRACE_SHADOW_MAPS,
  CLOUD_TRACE_SKY_LIGHT,
  type CloudTraceKey,
} from './traceExtraLayout.ts'

/**
 * THE VIEW TRACING'S OPTIONAL PARTS, each a function the march calls whatever the variation
 * (`CloudTraceKey`), answering as no such part would where the frame did not ask for it.
 * The program that includes them declares the trace block (\`cloudTrace\`), the air's frame
 * (\`frame\`) and the material (\`cloudMaterialBindings\`).
 *
 * - The empty-space table: the march starts at the step the table's texel of the ray's pixel says
 *   the cloud starts at, and steps one sample at a time over empty air (the table's texels must
 *   not show through a variable step).
 * - The sun's opaque shadow: the light of the first light at a sample is its share the shadow maps
 *   let through, read as a blend reads them (\`vsmSampleFactor\`: one sample of the sun's map at the
 *   sample's point, no ray start, no bias), where the sun's channel is given.
 * - The lamps: the lamps of the view's light grid cell of the sample, each with the light a point of
 *   a medium sees of it (\`volumeLamp\`: a lamp's range, inverse square and cone, a rectangle's form
 *   factor), times its \`fogScattering\` — a light of none gives nothing —, a cloud shadow ray
 *   toward it and the uniform phase, in each order of multiple scattering.
 * - The distant sky light: the mean radiance of the sky the air keeps for the haze; where the scene
 *   has no air, the sky light's own diffuse light of no direction (the harmonics' first terms, the
 *   light's colour not applied), bound in group 2.
 * - The cloud's own shade toward a light, where the material does not march it (\`volumeShadowMap\`):
 *   the optical depth the light's shadow map puts on the way to the sample, \`exp(-d)\` for the
 *   first order of scattering and \`exp(-d * e^n)\` for the order \`n\`, \`e\` the multiple scattering's
 *   extinction factor as the material gives it, bound in group 2. A light with no map shades nothing.
 */
const START_BINDING = `
@group(${G}) @binding(${B.startDistance}) var cloudStartDistance:texture_2d<f32>;
/** The step over empty air is one sample: the table's texels must not show through a longer one. */
fn cloudEmptyStep()->u32{return 0u;}`
const START_TEXEL = `
 let uv=(vec2f(p)+0.5)/vec2f(cloudTrace.traced.xy);
 let texel=min(vec2u(uv*${CLOUD_EMPTY_SPACE_SIDE}.0),vec2u(${CLOUD_EMPTY_SPACE_SIDE - 1}u));`
const EMPTY_SPACE = `${START_BINDING}
/** The first step of the march of the pixel \`p\` and the distance \`t\` it starts at, moved to the
 *  table's start of cloud: the table's texel of the ray's place in the traced image, in kilometres. */
fn cloudStartSteps(p:vec2u,t:ptr<function,f32>,stepT:f32)->u32{${START_TEXEL}
 let startCm=textureLoad(cloudStartDistance,texel,0).x*CM_PER_KM;
 if(*t>=startCm){return 0u;}
 let steps=u32(startCm/stepT);
 *t+=f32(steps)*stepT;
 return steps;
}`
const NO_EMPTY_SPACE = `
fn cloudEmptyStep()->u32{return cloudTrace.counts.z-1u;}
fn cloudStartSteps(p:vec2u,t:ptr<function,f32>,stepT:f32)->u32{return 0u;}`

/** The debug views of the tracing (\`CLOUD_DEBUG_VIEWS\`), compiled into a debug program alone: the march
 *  skips nothing, neither over empty air nor to the table's start, and counts the samples
 *  \`cloudDebugEmpty\` names; \`cloudDebugOf\` gives the two channels the view shows from them. A view 2 with
 *  no empty-space table counts none. The empty-space output is asked at the radius of a froxel of the table. */
const DEBUG_EMPTY_SPACE = `${START_BINDING}
/** Where the table starts the cloud on the ray of the pixel \`p\` of the traced image, in centimetres. */
fn cloudStartCm(p:vec2u)->f32{${START_TEXEL}
 return textureLoad(cloudStartDistance,texel,0).x*CM_PER_KM;
}
fn cloudStartSteps(p:vec2u,t:ptr<function,f32>,stepT:f32)->u32{return 0u;}`
const DEBUG_NO_EMPTY_SPACE = `
fn cloudEmptyStep()->u32{return 0u;}
fn cloudStartCm(p:vec2u)->f32{return 0.0;}
fn cloudStartSteps(p:vec2u,t:ptr<function,f32>,stepT:f32)->u32{return 0u;}`
const debugView = (p: CloudTraceKey) => `
const CLOUD_DEBUG_VIEW:u32=${p.debugView}u;
var<private> cloudDebugZero:u32;
var<private> cloudDebugValue:vec2f;
fn cloudDebugEmpty(rel:vec3f,probe:CloudProbe)->bool{${
  p.debugView === 2
    ? p.emptySpace
      ? `\n return cloudMaterialEmptySpace(rel,0.5*cloudTrace.empty.x*${CLOUD_EMPTY_SPACE_DIAGONAL})<=0.0;\n`
      : ' return false;'
    : ' return !cloudProbeDense(probe);'
}}
/** The share of the \`steps\` of a ray whose samples are not empty, and the table's start over the table's depth. */
fn cloudDebugOf(steps:f32,startCm:f32)->vec2f{
 return vec2f(1.0-saturate(f32(cloudDebugZero)/max(steps,1.0)),select(0.0,saturate(startCm/cloudTrace.empty.y),CLOUD_DEBUG_VIEW==2u));
}`

const OPAQUE_SHADOW = `
fn cloudOpaqueShadow(rel:vec3f)->f32{
 let channel=cloudTrace.options.w;
 if(channel==0xFFFFFFFFu){return 1.0;}
 return vsmSampleFactor(channel,cloudOrigin+rel*CLOUD_CM_TO_M);
}`
const NO_OPAQUE_SHADOW = 'fn cloudOpaqueShadow(rel:vec3f)->f32{return 1.0;}'

const LAMPS = `
@group(${G}) @binding(${B.tileLights}) var<storage,read> tileLights:array<u32>;
var<private> cloudLampPixel:vec2f;
/** The pixel of the view the thread traces, which the light grid's cell is found from. */
fn cloudLampsStart(traced:vec2u,scale:f32){cloudLampPixel=(vec2f(traced)+0.5)*scale;}
/** The device depth of the scene point \`P\` the light grid's slices are counted in. */
fn cloudLampDepth(P:vec3f)->f32{
 let clip=cloudTrace.viewProjection*vec4f(P,1.0);
 return clip.z/clip.w;
}
/** What the cloud lets through toward a lamp \`toLamp\` metres away from the point \`rel\`, for each
 *  order: the extinction of the material along a straight line to the lamp, the samples at the
 *  middle of equal segments, none outside the layer; one with no sample. */
fn cloudLampShadow(rel:vec3f,toLamp:vec3f,o:CloudOctaves)->array<vec3f,3>{
 var through=array<vec3f,3>(vec3f(1.0),vec3f(1.0),vec3f(1.0));
 let count=cloudTrace.local.x;
 if(count<=0.0){return through;}
 let lengthCm=length(toLamp)*CLOUD_M_TO_CM;
 let toward=toLamp/max(1e-5,length(toLamp));
 let each=1.0/count;
 var acc=array<vec3f,3>(vec3f(0.0),vec3f(0.0),vec3f(0.0));
 for(var s=0.5;s<count;s+=1.0){
  let there=cloudPointAt(rel+toward*(lengthCm*(s*each)));
  var extinction=there.spot.extinction;
  if(there.norm<=0.0||there.norm>=1.0){extinction=vec3f(0.0);}
  for(var m=0u;m<o.count;m++){acc[m]+=extinction*o.extinction[m];}
 }
 for(var m=0u;m<o.count;m++){through[m]=exp(-acc[m]*(lengthCm*CLOUD_CM_TO_M*each));}
 return through;
}
/** The light the lamps give the point \`rel\` centimetres from the eye, for each order. */
fn cloudLocalLights(rel:vec3f,o:CloudOctaves)->array<vec3f,3>{
 var sum=array<vec3f,3>(vec3f(0.0),vec3f(0.0),vec3f(0.0));
 let P=cloudOrigin+rel*CLOUD_CM_TO_M;
 let slice=cellSlice(gridCell(cloudLampPixel,cloudLampDepth(P),cloudTrace.view.zw));
 for(var i=0u;i<slice.y;i++){
  let rank=listedLight(slice,i);
  if(!listedDrawn(slice,rank)){continue;}
  if(!lightReaches(rank,P)){continue;}
  let light=directLights.items[rank];
  if(isSun(light)||light.params.z<=0.0){continue;}
  let seen=volumeLamp(light,P,LAMP_BIAS);
  if(seen.w<=0.0){continue;}
  let colour=light.colorIntensity.rgb*(lightStrength(light)*light.params.z*seen.w*UNIFORM_PHASE);
  let through=cloudLampShadow(rel,light.positionRange.xyz-P,o);
  for(var m=0u;m<o.count;m++){sum[m]+=colour*through[m];}
 }
 return sum;
}`
/** The cloud's shade toward light `k` at the point `rel` centimetres from the eye, for each order, read
 *  from the light's shadow map: the optical depth `d` of the map holds the light's strength already,
 *  so the order `n` lets through `exp(-d * e^n)`, the first order `exp(-d)`. */
const MAP_SHADOW = `
fn cloudMapShadow(rel:vec3f,k:u32,o:CloudOctaves)->array<vec3f,3>{
 let depth=cloudShadowDepth(k,cloudOrigin+rel*CLOUD_CM_TO_M);
 let base=saturate(cloudMaterial.multiScatter.y);
 var through=array<vec3f,3>(vec3f(1.0),vec3f(1.0),vec3f(1.0));
 for(var m=0u;m<o.count;m++){
  var factor=1.0;
  if(m>0u){factor=pow(base,f32(m));}
  through[m]=vec3f(exp(-depth*factor));
 }
 return through;
}`
const AIR_SKY = `fn cloudDistantSky()->vec3f{return directLights.atmosphereView[${VIEW_SLOT.haze}].xyz;}`
const SKY_LIGHT_SKY = `fn cloudDistantSky()->vec3f{return skyHarmonicsSimple(vec3f(0.0));}`
const NO_LAMPS = `
fn cloudLampsStart(traced:vec2u,scale:f32){}
fn cloudLocalLights(rel:vec3f,o:CloudOctaves)->array<vec3f,3>{
 return array<vec3f,3>(vec3f(0.0),vec3f(0.0),vec3f(0.0));
}`

const emptySpaceOf = (p: CloudTraceKey) =>
  p.debugView
    ? p.emptySpace
      ? DEBUG_EMPTY_SPACE
      : DEBUG_NO_EMPTY_SPACE
    : p.emptySpace
      ? EMPTY_SPACE
      : NO_EMPTY_SPACE

/** The optional parts of the variation \`p\`: the functions the march calls, and what they read. */
export const cloudTraceExtraWgsl = (p: CloudTraceKey) => {
  const uses: WgslDecl[] = [CLOUD_POINT_WGSL]
  if (p.opaqueShadow) {
    const vsm = B.vsm
    uses.push(
      vsmConsumerWgsl(vsm, G),
      vsmFragmentSampleWgsl(vsm.pool, B.vsmView, VSM_TRACE_KINDS_SUN, G),
    )
  }
  if (p.localLights)
    uses.push(
      directLightWgsl(),
      lightStrengthWgsl('cloudTrace.local.z'),
      TILE_SLICE_WGSL,
      VOLUME_LAMP_WGSL,
    )
  if (p.skyLight) uses.push(skyLightDiffuseWgsl(CLOUD_TRACE_SKY_LIGHT))
  if (p.volumeShadowMap) uses.push(cloudShadowReadWgsl(CLOUD_TRACE_SHADOW_MAPS))
  if (p.debugView === 2 && p.emptySpace) uses.push(CLOUD_MATERIAL_EMPTY_SPACE_WGSL)
  return wgslBlock(
    `cloudTraceExtraWgsl(${p.emptySpace}, ${p.opaqueShadow}, ${p.localLights}, ${p.skyLight}, ${p.volumeShadowMap}, ${p.debugView})`,
    uses,
    `${p.debugView ? `${debugView(p)}\n` : ''}${emptySpaceOf(p)}
${p.opaqueShadow ? OPAQUE_SHADOW : NO_OPAQUE_SHADOW}
${p.localLights ? LAMPS : NO_LAMPS}
${p.skyLight ? SKY_LIGHT_SKY : AIR_SKY}${p.volumeShadowMap ? MAP_SHADOW : ''}`,
  )
}
