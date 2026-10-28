import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { blueNoiseWgsl } from '../gpu/noise/blueNoiseWgsl.ts'
import { pixelToNdc, transformHomogeneousPoint } from '../../../math/src/wgsl/projection.ts'
import { r2Sequence } from '../../../math/src/wgsl/sampling.ts'
import { HAIR_MACRO_GROUP_SHIFT } from './materialMath.ts'
import { HAIR_VIEW_WGSL } from './ribbonWgsl.ts'
import { HAIR_TRAVERSAL_MAX_DISTANCE, voxelTraversalWgsl } from './voxelTraversalWgsl.ts'
import { VOXEL_PARAMS_WGSL } from './voxelWgsl.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COORD_MASK,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_GROUP_SIZE,
} from './visibilityMath.ts'

/** The binding of the blue noise in the program. */
const NOISE_BINDING = 10
/** The samples of a supersampled transmittance. */
const HAIR_TRANSMITTANCE_SUPERSAMPLES = 8
/** How far off the surface, along the ray, the position of a start is moved by the ray's jitter: half a voxel. */
const POSITION_BIAS_SCALE = 0.5

/** The bindings of the transmittance kernel and the number of rays a sample. */
const bindingsText = (
  supersampled: boolean,
) => `@group(0) @binding(1) var<storage,read> nodes:array<u32>;
@group(0) @binding(2) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(3) var<storage,read> voxels:array<u32>;
@group(0) @binding(4) var<storage,read> nodeCoord:array<u32>;
@group(0) @binding(5) var<storage,read> nodeData:array<u32>;
@group(0) @binding(6) var<storage,read> nodeCounter:array<u32>;
@group(0) @binding(7) var<storage,read_write> mask:array<u32>;
@group(0) @binding(8) var<uniform> view:HairView;
struct TransmittanceLight{
 position:vec4f,
 channels:u32,jitterMode:u32,frame:u32,pad0:u32,
 densityScale:f32,depthBiasScale:f32,steppingScale:f32,pad1:f32}
@group(0) @binding(9) var<uniform> light:TransmittanceLight;
const SAMPLES=${supersampled ? HAIR_TRANSMITTANCE_SUPERSAMPLES : 1}u;
const MAX_DISTANCE=${HAIR_TRAVERSAL_MAX_DISTANCE}.0;`

/** The blue-noise jitter of a ray, and the packing of the mask word. */
const JITTER_TEXT = `// A random vector of the pixel's blue noise for the supersample \`sampleIt\` of \`count\`.
fn voxelJitter(pixel:vec2u,sampleIt:u32,count:u32)->vec3f{
 if(light.jitterMode==0u){return vec3f(0.0);}
 let time=select(light.frame,0u,light.jitterMode>1u);
 let size=vec2f(BLUE_NOISE_TILE.xy);
 let a=blueNoiseVec2(pixel+vec2u(r2Sequence(sampleIt)*size),time);
 let b=blueNoiseVec2(pixel+vec2u(r2Sequence(sampleIt+count)*size),time);
 return vec3f(a,b.x);
}
fn packMask(hairCount:f32,visibility:f32)->u32{return min(u32(hairCount*1000.0),0x00FFFFFFu)|(min(u32(visibility*255.0),0xFFu)<<24u);}`

/** The kernel: a sample's hair count and visibility toward the light. */
const KERNEL_TEXT = `@compute @workgroup_size(${HAIR_NODE_GROUP_SIZE}) fn hairVoxelTransmittance(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let slot=flatIndex(id,groups,${HAIR_NODE_GROUP_SIZE}u);
 if(slot>=nodeCounter[${HAIR_NODE_COUNTER_STORED}]){return;}
 let at=nodeCoord[slot];
 let pixel=vec2u(at&${HAIR_COORD_MASK}u,at>>${HAIR_COORD_BITS}u);
 let o=slot*${HAIR_NODE_DATA_WORDS}u;
 if((light.channels&((nodeData[o+4u]>>24u)&7u))==0u){mask[slot]=0u;return;}
 let h=transformHomogeneousPoint(view.inverseViewProj,vec3f(pixelToNdc(vec2f(pixel)+vec2f(0.5),view.size),bitcast<f32>(nodeData[o])));
 let position=h.xyz/h.w;
 let toLight=select(normalize(light.position.xyz-position),-light.position.xyz,light.position.w==0.0);
 let lightPosition=select(light.position.xyz,position+toLight*MAX_DISTANCE,light.position.w==0.0);
 let node=nodeOf(nodeData[o+1u]>>${HAIR_MACRO_GROUP_SHIFT}u);
 var count=0.0;
 var visibility=0.0;
 for(var sampleIt=0u;sampleIt<SAMPLES;sampleIt++){
  let random=voxelJitter(pixel,sampleIt,SAMPLES);
  let bias=node.size*(light.depthBiasScale*toLight+${POSITION_BIAS_SCALE}*(random*2.0-vec3f(1.0)));
  let traversal=traceVoxels(position+bias,lightPosition,node,TraversalSettings(light.densityScale,opaqueVoxelValue(),MAX_DISTANCE,light.steppingScale,random,0.0,false,true));
  count+=traversal.hairCount;
  visibility+=traversal.visibility;
 }
 mask[slot]=packMask(count/f32(SAMPLES),visibility/f32(SAMPLES));
}`

/**
 * THE TRANSMITTANCE OF EACH COMPACTED SAMPLE TOWARD A LIGHT, through the voxels: for a sample (a thread a
 * stored sample) whose lighting channels the light shares (the reference first leaves out a pixel the opaque
 * surfaces' shadow of the light wholly took; that light is then nil at the sample whatever the mask, so the
 * test is not made), the ray from the sample toward the light is marched through its macro group's volume
 * (`traceVoxels`): the start is moved toward the light by `depthBias` voxels and off the ray by a blue-noise
 * jitter (`jitterMode`: none, per frame, or constant), and the hair count and the visibility the march
 * finds, averaged over the supersamples where there are some, are packed in the sample's word: the count
 * times 1000 on 24 bits and the visibility on the 8 above. A light with a position casts from its place; a
 * directional one from a thousand metres away along its direction. The sample's place is the visibility's
 * pixel centre at its depth. `mipmap` marches through the levels of the pages; `supersampled` takes 8 rays.
 * The screen-space trace that adds the fine occlusion of the nearby strands is not part of this program.
 */
export const voxelTransmittanceWgsl = (mipmap: boolean, supersampled: boolean) =>
  wgslProgram(`${bindingsText(supersampled)}\n${JITTER_TEXT}\n${KERNEL_TEXT}`, [
    VOXEL_PARAMS_WGSL,
    voxelTraversalWgsl(mipmap),
    HAIR_VIEW_WGSL,
    blueNoiseWgsl(0, NOISE_BINDING),
    pixelToNdc,
    transformHomogeneousPoint,
    FLAT_INDEX_WGSL,
    r2Sequence,
  ])
