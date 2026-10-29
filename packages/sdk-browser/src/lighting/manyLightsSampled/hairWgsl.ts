/**
 * THE SAMPLED LIGHTING OF THE HAIR STRANDS (`sampledLightsHairStrands`): the lights of each compacted strand sample are drawn by samples, and the transmittance of the strands toward each is traced
 * through the hair voxels, in two passes over the samples of the strands (`hair/lighting.ts` lights them after).
 *
 * - `hairSampleMain`: one thread a sample. The lights of its cell of the light grid that share a lighting channel with it are offered to a stratified sampler by the luminance of the light they give it
 *   (the hair BSDF, a mask that holds no hair; an estimate of power, range and falloff drops the faint ones first), each of the sample's `count` draws keeps one by a weighted reservoir, and writes the light's rank and its weight (the sum of the weights over the weight kept).
 *   With `flags.x` bit 0 the sun joins the draw and the rest the components of the fibre's scattering; `flags.y` is the block of pixels (across, down << 4) that draw with the same random numbers.
 * - `hairMaskMain`: one thread a sample, for each of its draws: the ray from the sample toward the point of the light the draw picks (`lightSampleTrace`) is marched through its macro group's voxels
 *   (`traceVoxels`, the reference's `TraverseHair`), and the hair count and the visibility the march finds are written as the mask word the strands' lighting reads (`hairTransmittanceFor`).
 * A draw is three words, `draws[(sample * count + draw) * 3]`: the rank (`HAIR_NO_LIGHT` for none), the weight, the mask (the sampling writes the empty one: no hair, all visible).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { pixelToNdc, transformHomogeneousPoint } from '../../../../math/src/wgsl/projection.ts'
import { rand4dPcg32 } from '../../../../math/src/wgsl/sampling.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { HAIR_MACRO_GROUP_SHIFT } from '../../hair/materialMath.ts'
import { HAIR_VIEW_WGSL } from '../../hair/ribbonWgsl.ts'
import {
  HAIR_PACK_MASK_WGSL,
  HAIR_TRAVERSAL_MAX_DISTANCE,
  voxelTraversalWgsl,
} from '../../hair/voxelTraversalWgsl.ts'
import { VOXEL_PARAMS_WGSL } from '../../hair/voxelWgsl.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COORD_MASK,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_GROUP_SIZE,
} from '../../hair/visibilityMath.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { lightStrengthWgsl } from '../direct/lightStrengthWgsl.ts'
import { lightChannelsOf } from '../direct/lightReachWgsl.ts'
import { TILE_SLICE_WGSL } from '../direct/lightingWgsl.ts'
import { HAIR_SAMPLE_WGSL } from '../../hair/sampleWgsl.ts'
import { hairScatteringWgsl } from '../../hair/hairBsdfWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../direct/lampSeenWgsl.ts'
import { LIGHT_TRACE_WGSL } from './lightTraceWgsl.ts'
import {
  NO_LIGHT_INDEX,
  addLightSample,
  candidateIndex,
  candidateWeight,
  estimateLocalLight,
  initLightSamplerStratified,
  lightTargetWeight,
  smoothFalloffMask,
} from './lightSamplerWgsl.ts'

export const HAIR_SAMPLE_ENTRY = 'hairSampleMain'
export const HAIR_MASK_ENTRY = 'hairMaskMain'
/** The rank a draw holds when no light was drawn. */
const HAIR_NO_LIGHT = 0xffffffff
/** The words of a draw. */
export const HAIR_DRAW_WORDS = 3
/** The words of the uniform: the eye, the frame, the draws of a sample, the flags, the light grid, the weights, the voxel settings. */
export const HAIR_PARAMS_WORDS = 16

/** Where the passes bind what they read and write, in group 0. */
export const HAIR_SAMPLED_BINDING = {
  /** The samples, the draws, the view and the uniform, at the numbers the strands' voxel transmittance binds its own at (the voxels take 0 to 3); the lights and the light grid's lists past them. */
  nodeCoord: 4,
  nodeData: 5,
  nodeCounter: 6,
  draws: 7,
  view: 8,
  params: 9,
  lights: 10,
  tiles: 11,
  /** The table of the fibre's scattering (a 3D texture) and its sampler, read by the weight of a light. */
  lut: 12,
} as const
const b = HAIR_SAMPLED_BINDING

const PARAMS_WGSL = wgslBlock(
  'HAIR_SAMPLED_PARAMS_WGSL',
  [],
  `struct HairSampledParams{
 eye:vec4f,
 frame:u32,count:u32,flags:vec2u,
 cells:vec2u,minEstimate:f32,minWeight:f32,
 voxel:vec4f,
}
@group(0) @binding(${b.params}) var<uniform> hs:HairSampledParams;`,
)

/** The position of a sample, in the camera's translated world, and the position the lights are read at (the world's). */
const SAMPLE_AT_WGSL = wgslBlock(
  'HAIR_SAMPLED_AT_WGSL',
  [HAIR_VIEW_WGSL, pixelToNdc, transformHomogeneousPoint],
  `fn hairSamplePixel(slot:u32)->vec2u{
 let at=hairCoord[slot];
 return vec2u(at&${HAIR_COORD_MASK}u,at>>${HAIR_COORD_BITS}u);
}
fn hairSamplePoint(slot:u32,pixel:vec2u)->vec3f{
 let h=transformHomogeneousPoint(view.inverseViewProj,vec3f(pixelToNdc(vec2f(pixel)+vec2f(0.5),view.size),bitcast<f32>(hairData[slot*${HAIR_NODE_DATA_WORDS}u])));
 return h.xyz/h.w;
}`,
)

const HEAD = `@group(0) @binding(${b.nodeCoord}) var<storage,read> hairCoord:array<u32>;
@group(0) @binding(${b.nodeData}) var<storage,read> hairData:array<u32>;
@group(0) @binding(${b.nodeCounter}) var<storage,read> hairCounter:array<u32>;
@group(0) @binding(${b.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${b.view}) var<uniform> view:HairView;
`

/** The draw of each sample's lights. The program declares the samples (`nodeCoord`, `nodeData`, `nodeCounter`), the lights and the draws. */
const HAIR_PART_1 = `/** The luminance of the light of colour 'radiance' from the direction 'toward' (unit) the strands' sample 'strand' at 'P' (the world's) gives, pre-exposed, by the hair BSDF with a mask that holds no hair. */
fn hairLuminance(strand:HairSample,P:vec3f,toward:vec3f,radiance:vec3f)->f32{
 let V=normalize(hs.eye.xyz-P);
 let td=hairTransmittance(V,toward,strand.colour,strand.roughness,0.0,strand.tangent,vec2f(0.0,1.0),hs.flags.x>>1u);
 return dot(hairShading(strand.colour,strand.roughness,strand.specular,strand.scatter,1.0,toward,V,strand.tangent,1.0,td,1.0,0.0)*radiance,vec3f(0.3,0.59,0.11))*hs.voxel.w;
}
@compute @workgroup_size(${HAIR_NODE_GROUP_SIZE}) fn ${HAIR_SAMPLE_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let slot=flatIndex(id,groups,${HAIR_NODE_GROUP_SIZE}u);
 if(slot>=hairCounter[${HAIR_NODE_COUNTER_STORED}]){return;}
 let pixel=hairSamplePixel(slot);
 let o=slot*${HAIR_NODE_DATA_WORDS}u;
 let strand=hairSampleOf(slot);
 let channels=strand.channels;
 let P=hairSamplePoint(slot,pixel)+hs.eye.xyz;
 let zDevice=bitcast<f32>(hairData[o]);
 let cell=cellSlice(gridCell(vec2f(pixel)+vec2f(0.5),zDevice,hs.cells));
 // The samples of a block of pixels (sampledLightsHairDownsample) draw with the same numbers.
 let block=pixel/vec2u(hs.flags.y&15u,hs.flags.y>>4u);
 let seed=rand4dPcg32(vec4i(vec3i(vec2i(block),i32(hs.frame)),7));
 var draw=initLightSamplerStratified(f32(seed.x)/4294967295.0,hs.count);
 for(var index=0u;index<cell.y;index++){
  let rank=listedLight(cell,index);
  if(!listedDrawn(cell,rank)){continue;}
  let light=directLights.items[rank];
  if(isSun(light)||(channels&lightChannelsOf(light))==0u){continue;}
`
const HAIR_PART_2 = `  let toLight=light.positionRange.xyz-P;
  let shares=sharesOf(light);
  let power=dot(light.colorIntensity.rgb,vec3f(0.3,0.59,0.11))*lightStrength(light)*max(shares.x,shares.y);
  let estimate=estimateLocalLight(dot(toLight,toLight),power,1.0/max(light.positionRange.w,1e-6),light.shape.y,hs.voxel.w);
  if(!isRect(light)&&estimate<hs.minEstimate){continue;}
  // The weight is the luminance of the light the fibre's response gives the sample (the hair BSDF, a mask that holds no hair), as the reference's target weighs it.
  let seen=volumeLamp(light,P,LAMP_BIAS);
  let weight=lightTargetWeight(hairLuminance(strand,P,seen.xyz,light.colorIntensity.rgb*(lightStrength(light)*seen.w)),hs.minWeight);
  if(weight>0.0){addLightSample(&draw,weight,rank,true,true,hs.count,0.0,0.0);}
 }
 if(hs.flags.x!=0u){
  for(var index=0u;index<cell.y;index++){
   let rank=listedLight(cell,index);
   let light=directLights.items[rank];
   if(!isSun(light)||(channels&lightChannelsOf(light))==0u){continue;}
   let weight=lightTargetWeight(hairLuminance(strand,P,-light.directionCone.xyz,light.colorIntensity.rgb*lightStrength(light)),hs.minWeight);
   if(weight>0.0){addLightSample(&draw,weight,rank,true,false,hs.count,0.0,0.0);}
  }
 }
 for(var i=0u;i<hs.count;i++){
  let drawn=draw.packed[i];
  let rank=candidateIndex(drawn);
  let at=(slot*hs.count+i)*${HAIR_DRAW_WORDS}u;
  draws[at]=select(rank,${HAIR_NO_LIGHT}u,rank==${NO_LIGHT_INDEX}u);
  draws[at+1u]=bitcast<u32>(select(0.0,draw.weightSum/candidateWeight(drawn),rank!=${NO_LIGHT_INDEX}u));
`
const HAIR_PART_3 = `  draws[at+2u]=0xFF000000u;
 }
}`

export const hairSampleWgsl = () =>
  wgslProgram(
    `${HEAD}@group(0) @binding(${b.tiles}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${b.draws}) var<storage,read_write> draws:array<u32>;
`,
    [
      DIRECT_LIGHT_WGSL,
      TILE_SLICE_WGSL,
      PARAMS_WGSL,
      SAMPLE_AT_WGSL,
      FLAT_INDEX_WGSL,
      rand4dPcg32,
      HAIR_SAMPLE_WGSL,
      VOLUME_LAMP_WGSL,
      hairScatteringWgsl(0, b.lut),
      lightStrengthWgsl('hs.voxel.w'),
      lightChannelsOf,
      initLightSamplerStratified,
      addLightSample,
      candidateIndex,
      candidateWeight,
      estimateLocalLight,
      lightTargetWeight,
      smoothFalloffMask,
      wgslBlock('HAIR_SAMPLE_KERNEL_WGSL', [], `${HAIR_PART_1}${HAIR_PART_2}${HAIR_PART_3}`),
    ],
  )

const MAX_DISTANCE = HAIR_TRAVERSAL_MAX_DISTANCE

/** The transmittance of each draw's ray through the strands' voxels. The program declares the voxels' bindings (`VOXEL_PARAMS_WGSL`, `nodes`, `pageIndex`, `voxels`) as the transmittance pass does. */
export const hairMaskWgsl = (mipmap: boolean) =>
  wgslProgram(
    `@group(0) @binding(1) var<storage,read> nodes:array<u32>;
@group(0) @binding(2) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(3) var<storage,read> voxels:array<u32>;
@group(0) @binding(${b.draws}) var<storage,read_write> draws:array<u32>;
${HEAD}`,
    [
      VOXEL_PARAMS_WGSL,
      voxelTraversalWgsl(mipmap),
      HAIR_PACK_MASK_WGSL,
      DIRECT_LIGHT_WGSL,
      PARAMS_WGSL,
      SAMPLE_AT_WGSL,
      FLAT_INDEX_WGSL,
      rand4dPcg32,
      LIGHT_TRACE_WGSL,
      wgslBlock(
        'HAIR_MASK_KERNEL_WGSL',
        [],
        `@compute @workgroup_size(${HAIR_NODE_GROUP_SIZE}) fn ${HAIR_MASK_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let slot=flatIndex(id,groups,${HAIR_NODE_GROUP_SIZE}u);
 if(slot>=hairCounter[${HAIR_NODE_COUNTER_STORED}]){return;}
 let pixel=hairSamplePixel(slot);
 let position=hairSamplePoint(slot,pixel);
 let node=nodeOf(hairData[slot*${HAIR_NODE_DATA_WORDS}u+1u]>>${HAIR_MACRO_GROUP_SHIFT}u);
 for(var i=0u;i<hs.count;i++){
  let at=(slot*hs.count+i)*${HAIR_DRAW_WORDS}u;
  let rank=draws[at];
  if(rank==${HAIR_NO_LIGHT}u){continue;}
  let seed=rand4dPcg32(vec4i(vec3i(vec2i(pixel),i32(hs.frame)),i32(11u+i)));
  let uv=vec2f(seed.xy)/4294967295.0;
  let random=vec3f(seed.zw,seed.x)/4294967295.0;
  let segment=lightSampleTrace(rank,position+hs.eye.xyz,uv);
  let toLight=segment.xyz;
  let end=position+toLight*min(segment.w,f32(${MAX_DISTANCE}));
  let bias=node.size*(hs.voxel.y*toLight+0.5*(random*2.0-vec3f(1.0)));
  let traversal=traceVoxels(position+bias,end,node,TraversalSettings(hs.voxel.x,opaqueVoxelValue(),f32(${MAX_DISTANCE}),hs.voxel.z,random,0.0,false,true));
  draws[at+2u]=packMask(traversal.hairCount,traversal.visibility);
 }
}`,
      ),
    ],
  )
