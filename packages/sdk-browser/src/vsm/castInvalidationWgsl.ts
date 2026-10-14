/**
 * THE ONE STALE OF THE SHADOW CHANGES (`castInvalidation.ts`), over the previous frame's maps, in
 * two ranges of records of one format: the list the passes appended
 * (`../webgpu/shadow/castChanges.ts`), read where it lies, never by the CPU, then the CPU's boxes
 * of what no row says (`castBoxes.ts`), read from their own buffer. One thread a (record, map) pair
 * stales a record's box (`vsmStaleBoxPages`), its map named through the one filter (`vsmStaleMap`,
 * `staleMapWgsl.ts`): a map drawing its moving casters over a receiver cover skips a box of casters
 * already moving.
 *
 * A list's record is a world box, its centre and its half extent, negative for casters already
 * moving; a CPU box's two vectors, its centre and moving sign, then its half extent per axis. A
 * list that overflowed reads as one box holding the world: every page goes stale, never fewer.
 *
 * The dispatch's size is the GPU's: a one-thread kernel (`CAST_ARGS_WGSL`) writes its indirect
 * arguments from the list's count, the CPU's boxes' and the maps', before the CPU could know the
 * list's count.
 */
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn, wgslStruct } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { ceilDivWgsl } from '../../../math/src/wgsl/integer.ts'
import { GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { UNBOUNDED_EXTENT, vsmInvalidationProgram } from './invalidationWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { VSM_STALE_MAP_WGSL } from './staleMapWgsl.ts'

/** Whether a list of `records` records whose header is `header` overflowed, and the boxes the stale
 *  reads: the list's then the CPU's `boxes`; one, the world's, once the list overflowed. The two
 *  kernels read it alike. */
const CASTS_WHOLE = wgslFn(
  'castsWhole',
  [],
  'fn castsWhole(header:vec4u,records:u32)->bool{return header.y!=0u||header.x>records;}',
)
const CAST_TOTAL = wgslFn(
  'castTotal',
  [CASTS_WHOLE],
  'fn castTotal(header:vec4u,records:u32,boxes:u32)->u32{return select(header.x+boxes,1u,castsWhole(header,records));}',
)

/** The stale's parameters, which its two kernels read: the maps' count, the CPU's boxes'. */
const CAST_PARAMS = wgslStruct(
  'VsmCastParams',
  [],
  'struct VsmCastParams{mapCount:u32,boxCount:u32,_pad0:u32,_pad1:u32,}',
)
/** Bytes of the stale's parameters (`VsmCastParams`). */
export const VSM_CAST_PARAMS_BYTES = 16

/** The pass's entry, one thread a (record, map) pair. */
export const CAST_INVALIDATION_ENTRY = 'vsmStaleCasts'

/** The stale of the list's records, then the CPU's boxes, over the previous frame's maps
 *  (`vsmStaleBoxPages`). */
export const castInvalidationWgsl = (layout: VsmLayout) =>
  vsmInvalidationProgram(
    layout,
    /* wgsl */ `
@group(1) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(1) @binding(1) var<storage,read> vsmCastMaps:array<u32>;
@group(1) @binding(2) var<storage,read> vsmCasts:array<vec4f>;
@group(1) @binding(3) var<storage,read> vsmCastBoxes:array<vec4f>;
const UNBOUNDED_EXTENT:f32=${wgslF32(UNBOUNDED_EXTENT)};
@compute @workgroup_size(WORKGROUP_THREADS)
fn ${CAST_INVALIDATION_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let thread=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lidx;
 let maps=vsmCast.mapCount;
 if(maps==0u){return;}
 let header=bitcast<vec4u>(vsmCasts[0]);
 let records=arrayLength(&vsmCasts)-1u;
 let box=thread/maps;
 if(box>=castTotal(header,records,vsmCast.boxCount)){return;}
 var inst=VsmInvalidationInstance(vec3f(0.0),0u,vec3f(UNBOUNDED_EXTENT));
 if(!castsWhole(header,records)){
  var record:vec4f;
  if(box<header.x){
   record=vsmCasts[1u+box];
   inst.extent=vec3f(abs(record.w));
  }else{
   let at=2u*(box-header.x);
   record=vsmCastBoxes[at];
   inst.extent=vsmCastBoxes[at+1u].xyz;
  }
  inst.centre=record.xyz;
  inst.flags=select(0u,VSM_BOX_MOVING,record.w<0.0);
 }
 let mapId=vsmStaleMap(vsmCastMaps[thread%maps],(inst.flags&VSM_BOX_MOVING)!=0u);
 if(mapId>=arrayLength(&vsmProjectionData)){return;}
 vsmStaleBoxPages(vsmProjectionOf(vsmHandleFromId(mapId)),inst);
}
`,
    [CAST_PARAMS, CAST_TOTAL, VSM_STALE_MAP_WGSL],
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
 let count=castTotal(casts[0],arrayLength(&casts)-1u,vsmCast.boxCount);
 let grid=groupGrid(ceilDiv(count*vsmCast.mapCount,WORKGROUP_THREADS));
 args[0]=grid.x;
 args[1]=grid.y;
 args[2]=1u;
}`,
  [CAST_PARAMS, GROUP_GRID_WGSL, CAST_TOTAL, ceilDivWgsl, WORKGROUP_THREADS_WGSL],
)
