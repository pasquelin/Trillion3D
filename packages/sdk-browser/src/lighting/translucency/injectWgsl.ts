import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { AIR_TINT_WGSL } from '../atmosphere/airTintWgsl.ts'
import { cloudShadowReadWgsl } from '../atmosphere/cloudShadowRead.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../direct/lampSeenWgsl.ts'
import { lightStrengthWgsl } from '../direct/lightStrengthWgsl.ts'
import { directShadowWgsl } from '../direct/shadowWgsl.ts'
import { NO_LIGHT_INDEX, smoothFalloffMask } from '../manyLightsSampled/lightSamplerWgsl.ts'
import { ML_SETS_WGSL } from '../manyLightsSampled/volumeWgsl.ts'
import { lightFunctionReadWgsl } from '../lightFunction/readWgsl.ts'
import { VSM_TRACE_KINDS_BOTH } from '../shadows/vsm/trace/traceWgsl.ts'
import { TV_FRAME_WGSL, TV_SH_WGSL, TV_TEXEL_WGSL } from './frameWgsl.ts'
import {
  MARKED_WORKGROUP,
  TRANSLUCENCY_WORKGROUP,
  VOLUME_FORMAT,
  WRAPPED_GROUP_STRIDE,
} from './layout.ts'

/** Where the injection binds what it reads and writes, in group 0: the light buffer, the frame, the lists of ranks
 *  of the lights each cascade is lit by, the texture written (`VOLUME_FORMAT`), the virtual shadow maps a light's shadow is read
 *  from (the page table, the projection's data, its uniforms, the pool's first slice and the projection's view),
 *  the light functions' atlas and the clouds' shade (the block, the two maps, the sampler), then the list of the marked cells and how many it
 *  holds (`translucencyVolumeMarkVoxels`; stand-ins where the cells are not marked). */
export const INJECT_BINDING = {
  lights: 0,
  frame: 1,
  ranks: 2,
  injected: 3,
  pageTable: 4,
  projectionData: 5,
  shadowUniforms: 6,
  pool: 7,
  shadowView: 8,
  lightFunction: 9,
  cloudShadow: 10,
  cloudShadowMap0: 11,
  cloudShadowMap1: 12,
  cloudShadowSampler: 13,
  marked: 14,
  markedCount: 15,
  ambientCube: 16,
  ambientCubeSampler: 17,
  ambientCubeColour: 18,
} as const
const b = INJECT_BINDING

/** A light's shadow, read as the fog volume reads it (`../fog/programs.ts`): one sample of the light's virtual
 *  shadow map at the cell's point, the sun's and a local light's alike. */
const SHADOW = directShadowWgsl({
  vsm: {
    pageTable: b.pageTable,
    projectionData: b.projectionData,
    uniforms: b.shadowUniforms,
    pool: b.pool,
  },
  trace: { view: b.shadowView, noise: 0 },
  quality: 0,
  localShadows: true,
  kinds: VSM_TRACE_KINDS_BOTH,
})

/** The light functions the injected lights wear, read at the cell's point. */
const LIGHT_FUNCTION = lightFunctionReadWgsl({
  group: 0,
  atlas: b.lightFunction,
  eye: 'tv.eye.xyz',
})

/** The clouds' shade of the air's lights, read at the cell's point. */
const CLOUD_SHADOW = cloudShadowReadWgsl({
  group: 0,
  block: b.cloudShadow,
  map0: b.cloudShadowMap0,
  map1: b.cloudShadowMap1,
  sampler: b.cloudShadowSampler,
})

/**
 * THE LIGHT EACH CELL OF THE VOLUME RECEIVES, one thread a cell of either cascade (`injectMain`, the cascades stacked
 * along the depth): the light of every light of its cascade's list, summed into the two-band harmonic
 * the volume holds (`TV_SH_WGSL`), written multiplied by the image's pre-exposure.
 *
 * A light's share at a cell is the one the surfaces take of the light at a point, the same terms in the same order:
 * its range, the cone of a spot and the face of a rectangle (`lightReaches`, whose first test is the sphere of
 * its reach); the point the light is read at — the cell's centre, moved half a cell away from the light, so that no
 * cell lies at the light's own centre and takes an overblown share —; the lamp's falloff there (`injectedLamp`: a
 * point's inverse square taken a square centimetre further whatever the lamp's size, a rectangle's form factor with no normal, the cone and
 * the window of its range); its colour times its intensity over π; its light function (a colour for a local light, one
 * grey for the sun) and the shadow of its virtual shadow map, one sample at the point (`shadowFactor`); for the sun, the
 * clouds' shade and the air's transmittance toward it (`cloudShadowOnSurface`, `airTintOf`).
 *
 * The outer cascade fades at its border (`tvBorder`): a local light's falloff and shadow go to zero, the sun's shadow
 * to none, so that the border cells hold what lights every surface beyond both cascades, the sun unshadowed and no
 * local light. The harmonic of a light is its colour in the constant band and, in the three linear ones, its
 * luminance times the direction toward it (`TV_SH_WGSL`); the ambient texture's alpha sums, for the sun, the share
 * of its light that reached the cell, the attenuation times the shadow.
 */
const INJECT_PART_1 = `
/** How much of a local light reaches \`P\`: a rectangle's form factor times its range window, any other lamp the point's falloff — its range window, its cone,
 *  its inverse square taken a square centimetre further — whatever size it has (the source radius and the tube's length are not read here). */
fn injectedLamp(light:DirectLight,P:vec3f)->f32{
 if(isRect(light)){return volumeLamp(light,P,LAMP_BIAS).w;}
 let reach=lampReach(light,P);
 return reach.w*select(1.0,pointFalloff(light.positionRange.xyz-P,LAMP_BIAS),light.shape.y<=0.0);
}
/** What one light adds at the cell's point \`P\` of \`cascade\`: its colour through the harmonic into \`ambient\` and
 *  \`directional\`. */
fn tvInjectWeighted(rank:u32,cascade:u32,P:vec3f,border:f32,weight:f32,mask:f32,traced:bool,ambient:ptr<function,vec4f>,directional:ptr<function,vec3f>){
 if(!lightReaches(rank,P)){return;}
 let light=directLights.items[rank];
 let sun=isSun(light);
 var L=-light.directionCone.xyz;
 if(!sun){L=normalize(light.positionRange.xyz-P);}
 // Half a cell away from the light, so that the light's own cell takes no overblown share.
 let lit=P-L*(0.5*tv.scale[cascade].w);
 var attenuation=1.0;
 if(!sun){attenuation=injectedLamp(light,lit);}
 if(attenuation<=0.0){return;}
 var shade=1.0;
 if(!traced){shade=shadowFactor(i32(light.params.y),light,lit,vec3f(0.0),true);}
 var colour=light.colorIntensity.rgb*(lightStrength(light)*INVERSE_PI);
 if(sun){
`
const INJECT_PART_2 = ` injectCell(id.z/dim,vec3u(id.x,id.y,id.z%dim));
}
/** The injection over the marked cells alone (\`translucencyVolumeMarkVoxels\`): one thread a cell of the list, its groups wrapped as the
 *  arguments' kernel wraps them (\`argsMain\`), a thread past the count returning at once. */
@compute @workgroup_size(${MARKED_WORKGROUP})
fn injectMarkedMain(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) lane:u32){
 let at=(groupId.x+(groupId.z*${WRAPPED_GROUP_STRIDE}u+groupId.y)*${WRAPPED_GROUP_STRIDE}u)*${MARKED_WORKGROUP}u+lane;
 if(at>=tvMarkedCount[0]){return;}
 let dim=tv.mode.x;
 let packed=tvMarked[at];
 let z=packed/(dim*dim);
 injectCell(z/dim,vec3u(packed%dim,(packed/dim)%dim,z%dim));
}`

/** The line that weights the light of the cell: the samples' weight, smoothed at the cut where the sampled lights mask it, or the plain weight. */
const injectWeightText = (sampled: boolean) =>
  sampled
    ? ' colour*=weight*select(1.0,smoothFalloffMask(luminance(colour)*tv.weights.x,mask),mask>0.0);\n'
    : ' colour*=weight;\n'

/** The loop over the lights of the cell: the list's, or the sun of the list and the local lights of the samples the fog's volume drew. */
const injectLoopText = (sampled: boolean) =>
  sampled
    ? `for(var i=0u;i<count;i++){
  // A sun the samples do not hold is injected as the list does; the local lights come from the samples the fog's volume drew at the cell's point.
  let rank=tvRanks[first+i];
  if(isSun(directLights.items[rank])&&mlp.flags2.x==0u){tvInject(rank,cascade,P,border,&ambient,&directional);}
 }
 var sets=mlSetsAt(vec3u(cell.x,cell.y,cell.z+cascade*dim),P);
 var next=mlLowest(&sets,true);
 while(next<${NO_LIGHT_INDEX}u){
  let rank=next;
  next=${NO_LIGHT_INDEX}u;
  let weight=mlTake(&sets,rank,true,&next);
  if(weight>0.0){tvInjectWeighted(rank,cascade,P,border,weight,mlp.weights.x,true,&ambient,&directional);}
 }`
    : `for(var i=0u;i<count;i++){tvInject(tvRanks[first+i],cascade,P,border,&ambient,&directional);}`

const injectWgsl = (sampled: boolean) =>
  wgslBlock(
    sampled ? 'INJECT_SAMPLED_WGSL' : 'INJECT_WGSL',
    [
      TV_FRAME_WGSL,
      TV_SH_WGSL,
      TV_TEXEL_WGSL,
      INVERSE_PI,
      luminance,
      VOLUME_LAMP_WGSL,
      AIR_TINT_WGSL,
      ...(sampled ? [ML_SETS_WGSL, smoothFalloffMask] : []),
    ],
    `${INJECT_PART_1}  shade*=dot(lightFunctionOf(light,lit),vec3f(0.3333))*cloudShadowOnSurface(rank,lit);
  if(cascade==1u){shade=mix(1.0,shade,border);}
  colour*=airTintOf(rank,light,lit);
 }else{
  if(cascade==1u){attenuation*=border;shade*=border;}
  colour*=lightFunctionOf(light,lit);
 }
 let share=attenuation*shade;
 colour*=share;
${injectWeightText(sampled)} let basis=tvBasis(L);
 *ambient+=vec4f(colour*basis.x,select(0.0,share,sun));
 *directional+=basis.yzw*luminance(colour);
}
fn tvInject(rank:u32,cascade:u32,P:vec3f,border:f32,ambient:ptr<function,vec4f>,directional:ptr<function,vec3f>){
 tvInjectWeighted(rank,cascade,P,border,1.0,0.0,false,ambient,directional);
}
/** The ambient cubemap's mean colour: the cube's last mip, a texel, read along a face's axis, times its colour (black where the image has no such cube). */
fn ambientCubeAverage()->vec3f{
 return textureSampleLevel(ambientCube,ambientCubeSampler,vec3f(1.0,0.0,0.0),f32(textureNumLevels(ambientCube)-1u)).rgb*ambientCubeColour.rgb;
}
/** The light cell \`cell\` of cascade \`cascade\` receives, written into the volume. */
fn injectCell(cascade:u32,cell:vec3u){
 let dim=tv.mode.x;
 let P=tvCellPoint(cascade,vec3f(cell));
 let border=select(1.0,tvBorder(cascade,(vec3f(cell)+vec3f(0.5))/f32(dim)),cascade==1u);
 var ambient=vec4f(0.0);
 var directional=vec3f(0.0);
 let first=tv.lists[cascade*2u];
 let count=tv.lists[cascade*2u+1u];
 ${injectLoopText(sampled)}
 // The ambient cubemap adds its mean colour to the ambient light of every cell, no harmonic: its last mip, the cube's one texel, times its colour.
 ambient+=vec4f(ambientCubeAverage(),0.0);
 // The light is written multiplied by the image's pre-exposure; the alpha, a share, is not.
 textureStore(tvInjected,vec3u(cell.xy,cell.z+tvSlab(cascade,0u)*dim),vec4f(ambient.rgb*tv.weights.x,ambient.a));
 textureStore(tvInjected,vec3u(cell.xy,cell.z+tvSlab(cascade,1u)*dim),vec4f(directional*tv.weights.x,0.0));
}
@compute @workgroup_size(${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP})
fn injectMain(@builtin(global_invocation_id) id:vec3u){
 let dim=tv.mode.x;
 if(id.x>=dim||id.y>=dim||id.z>=dim*2u){return;}
${INJECT_PART_2}`,
  )

/** The injection's program; with `sampled`, the one that lights its cells' local lights from the samples the fog's volume drew (`manyLightsSampled/volumeWgsl.ts`). */
export const injectProgram = (sampled: boolean) =>
  wgslProgram(
    `@group(0) @binding(${b.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${b.frame}) var<uniform> tv:TranslucencyFrame;
@group(0) @binding(${b.ranks}) var<storage,read> tvRanks:array<u32>;
@group(0) @binding(${b.injected}) var tvInjected:texture_storage_3d<${VOLUME_FORMAT},write>;
@group(0) @binding(${b.marked}) var<storage,read> tvMarked:array<u32>;
@group(0) @binding(${b.markedCount}) var<storage,read> tvMarkedCount:array<u32>;
@group(0) @binding(${b.ambientCube}) var ambientCube:texture_cube<f32>;
@group(0) @binding(${b.ambientCubeSampler}) var ambientCubeSampler:sampler;
@group(0) @binding(${b.ambientCubeColour}) var<uniform> ambientCubeColour:vec4f;
`,
    [
      DIRECT_LIGHT_WGSL,
      lightStrengthWgsl('tv.weights.w'),
      SHADOW,
      LIGHT_FUNCTION,
      CLOUD_SHADOW,
      injectWgsl(sampled),
    ],
  )

export const INJECT_PROGRAM = injectProgram(false)
