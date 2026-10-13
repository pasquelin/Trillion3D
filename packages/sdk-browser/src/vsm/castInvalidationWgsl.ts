/**
 * THE ROWS' SHADOW CHANGES, STALING THE PREVIOUS FRAME'S PAGES (`castInvalidation.ts`): the list the
 * rows pass appended (`../webgpu/shadow/castChanges.ts`) read where it lies, never by the CPU. One
 * thread a (record, map) pair: each record a world box, its centre and its half extent — negative
 * for casters already moving, which a map drawing its moving casters over a receiver cover
 * (`MAP_COVER`) skips, as the CPU's boxes do (`vsmInvalidationPhaseFromShadowBoxes`). A list that
 * overflowed reads as one box holding the world: every page goes stale, never fewer. The box is
 * staled as any instance is (`vsmStaleBoxPages`): identity rotation, its centre the translation.
 *
 * The dispatch's size is the GPU's: a one-thread kernel (`CAST_ARGS_WGSL`) writes its indirect
 * arguments from the list's count and the maps', before the CPU could know the count.
 */
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { GROUP_GRID_WGSL } from '../gpu/dispatch/grid.ts'
import {
  UNBOUNDED_EXTENT,
  VSM_INVALIDATION_GROUP_SIZE,
  vsmInvalidationProgram,
} from './invalidationWgsl.ts'
import type { VsmLayout } from './layout.ts'

/** A map's word in the list the CPU sends (`vsmCastMaps`): its id, and whether it draws its moving
 *  casters over a receiver cover. */
const MAP_ID = 0x7fffffff
export const MAP_COVER = 0x80000000

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

/** The pass's entry, one thread a (record, map) pair. */
export const CAST_INVALIDATION_ENTRY = 'vsmStaleCasts'

/** The stale of the rows' changes over the previous frame's maps (`vsmStaleBoxPages`). */
export const castInvalidationWgsl = (layout: VsmLayout) =>
  vsmInvalidationProgram(
    layout,
    /* wgsl */ `
struct VsmCastParams{mapCount:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(1) @binding(0) var<uniform> vsmCast:VsmCastParams;
@group(1) @binding(1) var<storage,read> vsmCastMaps:array<u32>;
@group(1) @binding(2) var<storage,read> vsmCasts:array<vec4f>;
${wgslConsts({ VSM_INVALIDATION_GROUP_SIZE, MAP_ID, MAP_COVER })}
const UNBOUNDED_EXTENT:f32=${wgslF32(UNBOUNDED_EXTENT)};
@compute @workgroup_size(VSM_INVALIDATION_GROUP_SIZE)
fn ${CAST_INVALIDATION_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let thread=flatIndex(wid,nwg,1u)*VSM_INVALIDATION_GROUP_SIZE+lidx;
 let maps=vsmCast.mapCount;
 if(maps==0u){return;}
 let header=bitcast<vec4u>(vsmCasts[0]);
 let records=arrayLength(&vsmCasts)-1u;
 let whole=castsWhole(header,records);
 let count=castCount(header,records);
 let box=thread/maps;
 if(box>=count){return;}
 let word=vsmCastMaps[thread%maps];
 var centre=vec3f(0.0);
 var extent=UNBOUNDED_EXTENT;
 var moving=false;
 if(!whole){
  let record=vsmCasts[1u+box];
  centre=record.xyz;
  extent=abs(record.w);
  moving=record.w<0.0;
 }
 if(moving&&(word&MAP_COVER)!=0u){return;}
 let mapId=word&MAP_ID;
 if(mapId>=arrayLength(&vsmProjectionData)){return;}
 var inst:VsmInvalidationInstance;
 inst.localToWorld0=vec4f(1.0,0.0,0.0,centre.x);
 inst.localToWorld1=vec4f(0.0,1.0,0.0,centre.y);
 inst.localToWorld2=vec4f(0.0,0.0,1.0,centre.z);
 inst.boxExtent=vec3f(extent);
 inst.flags=VSM_BOX_CASTS|select(0u,VSM_BOX_MOVING,moving);
 vsmStaleBoxPages(vsmProjectionOf(vsmHandleFromId(mapId)),inst);
}
`,
    [CAST_COUNT],
  )

/** The arguments' kernel's entry. */
export const CAST_ARGS_ENTRY = 'vsmCastArgs'

/** One thread: the stale's indirect arguments, its workgroups over every (record, map) pair, in
 *  rows (`groupGrid`). */
export const CAST_ARGS_WGSL = wgslProgram(
  /* wgsl */ `
struct Params{mapCount:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> casts:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1) fn ${CAST_ARGS_ENTRY}(){
 let header=casts[0];
 let records=arrayLength(&casts)-1u;
 let count=castCount(header,records);
 let grid=groupGrid((count*params.mapCount+${VSM_INVALIDATION_GROUP_SIZE - 1}u)/${VSM_INVALIDATION_GROUP_SIZE}u);
 args[0]=grid.x;
 args[1]=grid.y;
 args[2]=1u;
}`,
  [GROUP_GRID_WGSL, CAST_COUNT],
)
