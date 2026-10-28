/**
 * THE COMPACTION OF THE RAYS STILL TO BE TRACED: one thread a sample over the samples' texture; a thread whose ray is not complete (and, for the
 * screen's trace, is one the screen traces: not a two-sided or transmitting surface's, not a hair pixel's where the setting leaves hair out) takes a place in the
 * group's list, the group takes its place in the image's list with one atomic, and the passes that trace read that list, a thread a ray, in place of every sample. The list's
 * length is turned into the groups of the dispatch over it (`compactArgsMain`). The order of the list is that of the atomics: no pass reads it in order.
 * `MODE` 0 compacts for the screen's trace, into the first list (`compactCount[0]`, `compactData` from 0), 1 for the traces after it, into the second
 * (`compactCount[1]`, `compactData` from one list's length, `params.sampleView` columns by rows), 2 for the shadow maps' trace, into the third: the rays of the
 * samples whose light the maps shadow.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_GROUP } from './layout.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import {
  NO_LIGHT_INDEX,
  RAY_TYPE,
  lightSampleIndex,
  lightSampleRayCompleted,
  lightSampleRayType,
} from './lightSamplerWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'

const B = SAMPLED_BINDINGS

/** The threads of the dispatch over the compacted list. */
export const COMPACT_THREADS = 64

export const COMPACT_ENTRY = 'compactTracesMain'
export const COMPACT_ARGS_ENTRY = 'compactArgsMain'

/** A sample's place in the list: its column in the high half, its row in the low. */
export const TRACE_TEXEL_WGSL = wgslBlock(
  'SAMPLED_TRACE_TEXEL_WGSL',
  [],
  `fn packTraceTexel(c:vec2u)->u32{return (c.x<<16u)|(c.y&0xFFFFu);}
fn unpackTraceTexel(p:u32)->vec2u{return vec2u(p>>16u,p&0xFFFFu);}`,
)

export const compactWgsl = () =>
  wgslProgram(
    `
override MODE:u32=0u;
@group(0) @binding(${B.rays}) var rays:texture_storage_2d<r32uint,read_write>;
@group(0) @binding(${B.samples}) var samples:texture_storage_2d<r32uint,read_write>;
@group(0) @binding(${B.compactData}) var<storage,read_write> compactData:array<u32>;
@group(0) @binding(${B.compactCount}) var<storage,read_write> compactCount:array<atomic<u32>>;
var<workgroup> groupCount:atomic<u32>;
var<workgroup> groupBase:u32;
var<workgroup> groupList:array<u32,${SAMPLED_GROUP * SAMPLED_GROUP}>;
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${COMPACT_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&groupCount,0u);}
 workgroupBarrier();
 if(all(id.xy<params.sampleView)){
  let ray=textureLoad(rays,vec2i(id.xy)).r;
  var accept=!lightSampleRayCompleted(ray);
  if(accept&&MODE==2u){
   let index=lightSampleIndex(textureLoad(samples,vec2i(id.xy)).r);
   accept=index!=${NO_LIGHT_INDEX}u&&i32(directLights.items[index].params.y)>=0;
  }
  if(accept&&MODE==0u){
   let kind=lightSampleRayType(ray);
   if(kind==${RAY_TYPE.twoSided}u||kind==${RAY_TYPE.transmission}u){accept=false;}
   if(kind==${RAY_TYPE.hair}u&&params.screenTrace.z==0u){accept=false;}
  }
  if(accept){groupList[atomicAdd(&groupCount,1u)]=packTraceTexel(id.xy);}
 }
 workgroupBarrier();
 let n=atomicLoad(&groupCount);
 if(lane==0u&&n>0u){groupBase=atomicAdd(&compactCount[MODE],n)+MODE*params.sampleView.x*params.sampleView.y;}
 workgroupBarrier();
 if(lane<n){compactData[groupBase+lane]=groupList[lane];}
}`,
    [
      SAMPLED_PARAMS_WGSL,
      TRACE_TEXEL_WGSL,
      DIRECT_LIGHT_WGSL,
      LIGHTS_BINDING_WGSL,
      lightSampleIndex,
      lightSampleRayCompleted,
      lightSampleRayType,
    ],
  )

/** The groups of the dispatch over list `SLOT`: its length over the threads of a group, rounded up, then one and one. */
export const compactArgsWgsl = () =>
  wgslProgram(
    `
override SLOT:u32=0u;
@group(0) @binding(${B.compactCount}) var<storage,read> compactCount:array<u32>;
@group(0) @binding(${B.compactArgs}) var<storage,read_write> compactArgs:array<u32>;
@compute @workgroup_size(1,1,1)
fn ${COMPACT_ARGS_ENTRY}(){
 compactArgs[SLOT*3u]=(compactCount[SLOT]+${COMPACT_THREADS - 1}u)/${COMPACT_THREADS}u;
 compactArgs[SLOT*3u+1u]=1u;
 compactArgs[SLOT*3u+2u]=1u;
}`,
    [],
  )

/** Where list `slot` starts in `compactData` and its dispatch's arguments in `compactArgs`, in bytes. */
export const compactArgsAt = (slot: number) => slot * 12
