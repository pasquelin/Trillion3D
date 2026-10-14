/**
 * THE ONE STALE OF THE SHADOW CHANGES (`castInvalidation.ts`), over the previous frame's maps: the
 * list the passes appended (`../webgpu/shadow/castChanges.ts`), read where it lies, never by the
 * CPU. The CPU's boxes of what no row says (`castBoxes.ts`), records of the list's own format, are
 * appended to it first (`CAST_APPEND_WGSL`). One thread a (record, map) pair stales a record's box
 * (`vsmStaleBoxPages`), its map named through the one filter (`vsmStaleMap`, `staleMapWgsl.ts`): a
 * map drawing its moving casters over a receiver cover skips a box of casters already moving.
 *
 * A record is a world box, its centre and its half extent, negative for casters already moving. A
 * list that overflowed reads as one box holding the world: every page goes stale, never fewer.
 *
 * The dispatch's size is the GPU's: a one-thread kernel (`CAST_ARGS_WGSL`) writes its indirect
 * arguments from the list's count and the maps', before the CPU could know the count.
 */
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn, wgslStruct } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS,
  WORKGROUP_THREADS_WGSL,
} from '../gpu/dispatch/grid.ts'
import { CAST_EMIT_WGSL } from '../webgpu/shadow/castChangesWgsl.ts'
import { UNBOUNDED_EXTENT, vsmInvalidationProgram } from './invalidationWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { VSM_STALE_MAP_WGSL } from './staleMapWgsl.ts'

/** Whether a list of `records` records whose header is `header` overflowed, and the boxes it holds
 *  to stale: one, the world's, once it overflowed. The two kernels read it alike. */
const CASTS_WHOLE = wgslFn(
  'castsWhole',
  [],
  'fn castsWhole(header:vec4u,records:u32)->bool{return header.y!=0u||header.x>records;}',
)
const CAST_COUNT = wgslFn(
  'castCount',
  [CASTS_WHOLE],
  'fn castCount(header:vec4u,records:u32)->u32{return select(header.x,1u,castsWhole(header,records));}',
)

/** The stale's parameters, which its three kernels read: the maps' count, the CPU's boxes'. */
const CAST_PARAMS = wgslStruct(
  'VsmCastParams',
  [],
  'struct VsmCastParams{mapCount:u32,boxCount:u32,_pad0:u32,_pad1:u32,}',
)
/** Bytes of the stale's parameters (`VsmCastParams`). */
export const VSM_CAST_PARAMS_BYTES = 16

/** The pass's entry, one thread a (record, map) pair. */
export const CAST_INVALIDATION_ENTRY = 'vsmStaleCasts'

/** The stale of the list's records over the previous frame's maps (`vsmStaleBoxPages`). */
export const castInvalidationWgsl = (layout: VsmLayout) =>
  vsmInvalidationProgram(
    layout,
    /* wgsl */ `
@group(1) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(1) @binding(1) var<storage,read> vsmCastMaps:array<u32>;
@group(1) @binding(2) var<storage,read> vsmCasts:array<vec4f>;
const UNBOUNDED_EXTENT:f32=${wgslF32(UNBOUNDED_EXTENT)};
@compute @workgroup_size(WORKGROUP_THREADS)
fn ${CAST_INVALIDATION_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let thread=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lidx;
 let maps=vsmCast.mapCount;
 if(maps==0u){return;}
 let header=bitcast<vec4u>(vsmCasts[0]);
 let records=arrayLength(&vsmCasts)-1u;
 let box=thread/maps;
 if(box>=castCount(header,records)){return;}
 var inst=VsmInvalidationInstance(vec3f(0.0),VSM_BOX_CASTS,vec3f(UNBOUNDED_EXTENT));
 if(!castsWhole(header,records)){
  let record=vsmCasts[1u+box];
  inst.centre=record.xyz;
  inst.extent=vec3f(abs(record.w));
  inst.flags=VSM_BOX_CASTS|select(0u,VSM_BOX_MOVING,record.w<0.0);
 }
 let mapId=vsmStaleMap(vsmCastMaps[thread%maps],(inst.flags&VSM_BOX_MOVING)!=0u);
 if(mapId>=arrayLength(&vsmProjectionData)){return;}
 vsmStaleBoxPages(vsmProjectionOf(vsmHandleFromId(mapId)),inst);
}
`,
    [CAST_PARAMS, CAST_COUNT, VSM_STALE_MAP_WGSL],
  )

/** The arguments' kernel's entry. */
export const CAST_ARGS_ENTRY = 'vsmCastArgs'

/** One thread: the stale's indirect arguments, its workgroups over every (record, map) pair, in
 *  rows (`groupGrid`). */
export const CAST_ARGS_WGSL = wgslProgram(
  /* wgsl */ `
@group(0) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(0) @binding(1) var<storage,read> casts:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1) fn ${CAST_ARGS_ENTRY}(){
 let count=castCount(casts[0],arrayLength(&casts)-1u);
 let grid=groupGrid((count*vsmCast.mapCount+${WORKGROUP_THREADS - 1}u)/${WORKGROUP_THREADS}u);
 args[0]=grid.x;
 args[1]=grid.y;
 args[2]=1u;
}`,
  [CAST_PARAMS, GROUP_GRID_WGSL, CAST_COUNT],
)

/** The appending kernel's entry. */
export const CAST_APPEND_ENTRY = 'vsmCastAppend'

/** One thread a CPU box: its record appended to the list as the rows pass appends its own
 *  (`emitCast`), past the list's room the overflow flag set. */
export const CAST_APPEND_WGSL = wgslProgram(
  /* wgsl */ `
@group(0) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(0) @binding(1) var<storage,read> vsmCastBoxes:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> castChanges:array<atomic<u32>>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn ${CAST_APPEND_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let box=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lidx;
 if(box>=vsmCast.boxCount){return;}
 let record=vsmCastBoxes[box];
 emitCast(record.xyz,abs(record.w),record.w<0.0);
}`,
  [CAST_PARAMS, CAST_EMIT_WGSL, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
)
