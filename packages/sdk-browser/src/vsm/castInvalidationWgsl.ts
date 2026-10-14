/**
 * THE ONE STALE OF THE SHADOW CHANGES (`castInvalidation.ts`), over the previous frame's maps: the
 * list the rows pass appended (`../webgpu/shadow/castChanges.ts`), read where it lies, never by the
 * CPU, then the boxes the CPU wrote of what no row says (`invalidationPhase.ts`). One thread a
 * (change, map) pair, every change one instance of identity rotation staled as any is
 * (`vsmStaleBoxPages`), its map named through the one filter (`vsmStaleMap`, `staleMapWgsl.ts`): a
 * map drawing its moving casters over a receiver cover skips a box of casters already moving.
 *
 * A record of the list is a world box, its centre and its half extent — negative for casters already
 * moving. A list that overflowed reads as one box holding the world: every page goes stale, never
 * fewer. A CPU box (`VsmCastBox`) keeps its centre split high and low and its extent per axis.
 *
 * The dispatch's size is the GPU's: a one-thread kernel (`CAST_ARGS_WGSL`) writes its indirect
 * arguments from the list's count, the CPU's boxes and the maps', before the CPU could know the count.
 */
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { GROUP_GRID_WGSL, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
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

/** Bytes of a CPU box (`VsmCastBox`): its centre's high f32 and its flags, its centre's low f32,
 *  its half extent. */
export const VSM_CAST_BOX_BYTES = 48

/** The instance of identity rotation a change stales, its translation `centre` + `low`. */
const CAST_INSTANCE = wgslFn(
  'vsmCastInstance',
  [],
  `fn vsmCastInstance(centre:vec3f,low:vec3f,extent:vec3f,flags:u32)->VsmInvalidationInstance{
 var inst:VsmInvalidationInstance;
 inst.localToWorld0=vec4f(1.0,0.0,0.0,centre.x);
 inst.localToWorld1=vec4f(0.0,1.0,0.0,centre.y);
 inst.localToWorld2=vec4f(0.0,0.0,1.0,centre.z);
 inst.translationLow=low;
 inst.boxExtent=extent;
 inst.flags=flags;
 return inst;
}`,
)

/** The pass's entry, one thread a (change, map) pair. */
export const CAST_INVALIDATION_ENTRY = 'vsmStaleCasts'

/** The stale of the rows' changes over the previous frame's maps (`vsmStaleBoxPages`). */
export const castInvalidationWgsl = (layout: VsmLayout) =>
  vsmInvalidationProgram(
    layout,
    /* wgsl */ `
struct VsmCastParams{mapCount:u32,boxCount:u32,_pad0:u32,_pad1:u32,}
struct VsmCastBox{centre:vec3f,flags:u32,low:vec3f,_pad0:u32,extent:vec3f,_pad1:u32,}
@group(1) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(1) @binding(1) var<storage,read> vsmCastMaps:array<u32>;
@group(1) @binding(2) var<storage,read> vsmCasts:array<vec4f>;
@group(1) @binding(3) var<storage,read> vsmCastBoxes:array<VsmCastBox>;
const UNBOUNDED_EXTENT:f32=${wgslF32(UNBOUNDED_EXTENT)};
@compute @workgroup_size(WORKGROUP_THREADS)
fn ${CAST_INVALIDATION_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let thread=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lidx;
 let maps=vsmCast.mapCount;
 if(maps==0u){return;}
 let header=bitcast<vec4u>(vsmCasts[0]);
 let records=arrayLength(&vsmCasts)-1u;
 let listed=castCount(header,records);
 let box=thread/maps;
 if(box>=listed+vsmCast.boxCount){return;}
 let word=vsmCastMaps[thread%maps];
 var inst:VsmInvalidationInstance;
 if(box<listed){
  var centre=vec3f(0.0);
  var extent=UNBOUNDED_EXTENT;
  var moving=false;
  if(!castsWhole(header,records)){
   let record=vsmCasts[1u+box];
   centre=record.xyz;
   extent=abs(record.w);
   moving=record.w<0.0;
  }
  inst=vsmCastInstance(centre,vec3f(0.0),vec3f(extent),VSM_BOX_CASTS|select(0u,VSM_BOX_MOVING,moving));
 }else{
  let cpu=vsmCastBoxes[box-listed];
  inst=vsmCastInstance(cpu.centre,cpu.low,cpu.extent,cpu.flags);
 }
 let mapId=vsmStaleMap(word,(inst.flags&VSM_BOX_MOVING)!=0u);
 if(mapId>=arrayLength(&vsmProjectionData)){return;}
 vsmStaleBoxPages(vsmProjectionOf(vsmHandleFromId(mapId)),inst);
}
`,
    [CAST_COUNT, CAST_INSTANCE, VSM_STALE_MAP_WGSL],
  )

/** The arguments' kernel's entry. */
export const CAST_ARGS_ENTRY = 'vsmCastArgs'

/** One thread: the stale's indirect arguments, its workgroups over every (change, map) pair — the
 *  list's records, then the CPU's boxes —, in rows (`groupGrid`). */
export const CAST_ARGS_WGSL = wgslProgram(
  /* wgsl */ `
struct Params{mapCount:u32,boxCount:u32,_pad0:u32,_pad1:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> casts:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1) fn ${CAST_ARGS_ENTRY}(){
 let header=casts[0];
 let records=arrayLength(&casts)-1u;
 let count=castCount(header,records)+params.boxCount;
 let grid=groupGrid((count*params.mapCount+${WORKGROUP_THREADS - 1}u)/${WORKGROUP_THREADS}u);
 args[0]=grid.x;
 args[1]=grid.y;
 args[2]=1u;
}`,
  [GROUP_GRID_WGSL, CAST_COUNT],
)
