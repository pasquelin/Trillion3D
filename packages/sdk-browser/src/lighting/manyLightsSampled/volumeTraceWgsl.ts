/**
 * THE VOLUME'S RAYS COMPACTED, THEN TRACED: the sampling (`volumeSampleMain`) leaves, for each sample whose light must be traced, a mark in the rays' texture; the passes below turn the marks into a
 * list of samples and trace only those, as the screen's samples are (`compactWgsl.ts`).
 *
 * - `volumeCompactResetMain`: the list's length set to zero, before the compaction.
 * - `volumeCompactMain`: one thread a sample of the volume; a marked sample takes a place in its group's list, the group takes its place in the volume's list with one atomic (the order is that of the atomics).
 * - `volumeCompactArgsMain`: the length of the list turned into the groups of the dispatch over it.
 * - `volumeTraceMain`: one thread a listed sample; the ray from the voxel's point toward the point of the light the sample picks goes through the global distance field, and a blocked sample is no longer visible.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { COMPACT_THREADS } from './compactWgsl.ts'
import { LIGHT_TRACE_WGSL } from './lightTraceWgsl.ts'
import { ML_BINDING as B } from './volumeBindings.ts'
import { ML_GRID_WGSL } from './volumeWgsl.ts'

/** The bindings the trace program declares, before the field's trace: the lights, the samples it reads and writes, the list and its length. */
export const VOLUME_TRACE_BINDINGS = `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.samplesOut}) var mlSamples:texture_storage_3d<r32uint,read_write>;
@group(0) @binding(${B.compactData}) var<storage,read> compactData:array<u32>;
@group(0) @binding(${B.compactCount}) var<storage,read> compactCount:array<u32>;
`

export const VOLUME_COMPACT_RESET_ENTRY = 'volumeCompactResetMain'
export const VOLUME_COMPACT_ENTRY = 'volumeCompactMain'
export const VOLUME_COMPACT_ARGS_ENTRY = 'volumeCompactArgsMain'
export const VOLUME_TRACE_ENTRY = 'volumeTraceMain'
/** The threads of a group of the compaction, along each axis (their list holds that cubed). */
const COMPACT_GROUP = 4

/** The list's length: the one word the compaction counts in, and the dispatch arguments built from it. */
export const volumeCompactResetText = () =>
  `@group(0) @binding(${B.compactCount}) var<storage,read_write> compactCount:array<u32>;
@compute @workgroup_size(1)
fn ${VOLUME_COMPACT_RESET_ENTRY}(){compactCount[0]=0u;}`

export const volumeCompactText = () =>
  `@group(0) @binding(${B.raysIn}) var mlRaysIn:texture_storage_3d<r32uint,read>;
@group(0) @binding(${B.compactData}) var<storage,read_write> compactData:array<u32>;
@group(0) @binding(${B.compactCount}) var<storage,read_write> compactCount:array<atomic<u32>>;
var<workgroup> groupCount:atomic<u32>;
var<workgroup> groupBase:u32;
var<workgroup> groupList:array<u32,${COMPACT_GROUP ** 3}>;
@compute @workgroup_size(${COMPACT_GROUP},${COMPACT_GROUP},${COMPACT_GROUP})
fn ${VOLUME_COMPACT_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&groupCount,0u);}
 workgroupBarrier();
 let size=textureDimensions(mlRaysIn);
 if(all(id<size)&&textureLoad(mlRaysIn,vec3i(id)).r!=0u){
  groupList[atomicAdd(&groupCount,1u)]=(id.z*size.y+id.y)*size.x+id.x;
 }
 workgroupBarrier();
 let n=atomicLoad(&groupCount);
 if(lane==0u&&n>0u){groupBase=atomicAdd(&compactCount[0],n);}
 workgroupBarrier();
 if(lane<n){compactData[groupBase+lane]=groupList[lane];}
}`

export const volumeCompactArgsText = () =>
  `@group(0) @binding(${B.compactCount}) var<storage,read> compactCount:array<u32>;
@group(0) @binding(${B.compactArgs}) var<storage,read_write> compactArgs:array<u32>;
@compute @workgroup_size(1)
fn ${VOLUME_COMPACT_ARGS_ENTRY}(){
 compactArgs[0]=(compactCount[0]+${COMPACT_THREADS - 1}u)/${COMPACT_THREADS}u;
 compactArgs[1]=1u;
 compactArgs[2]=1u;
}`

/** The trace of the listed samples; the program declares the light buffer 'directLights', the samples 'mlSamples' (read and written), the list 'compactData' and its length, and 'mlWorldBlocked'. */
export const ML_TRACE_WGSL = wgslBlock(
  'ML_TRACE_WGSL',
  [ML_GRID_WGSL, LIGHT_TRACE_WGSL],
  `@compute @workgroup_size(${COMPACT_THREADS})
fn ${VOLUME_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=compactCount[0]){return;}
 let at=compactData[id.x];
 let size=textureDimensions(mlSamples);
 let coord=vec3u(at%size.x,(at/size.x)%size.y,at/(size.x*size.y));
 let d=coord/mlp.samples.xyz;
 let i=(coord.y%mlp.samples.y)*mlp.samples.x+coord.x%mlp.samples.x;
 let word=textureLoad(mlSamples,vec3i(coord)).r;
 let cell=(d<<vec3u(mlp.down.w))+mlVoxelJitter(d);
 let P=mlPoint(vec3f(cell)+mlp.jitter.xyz).xyz;
 let segment=lightSampleTrace(word&0x7FFFu,P,mlRandom(d,1u+i).xy);
 if(mlWorldBlocked(P,P+segment.xyz*min(segment.w,1.0e5),d)){textureStore(mlSamples,vec3i(coord),vec4u(word&0x7FFFFFFFu,0u,0u,0u));}
}`,
)
