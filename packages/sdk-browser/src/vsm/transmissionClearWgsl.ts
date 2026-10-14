import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_RENDER_ROWS_WGSL, vsmCandidatesKernel } from './renderCandidatesWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import {
  FRAME_STRUCT_WGSL,
  VSM_TRANSMISSION_PAGE_GROUP,
  frameWgsl,
  transmissionTablesWgsl,
} from './transmissionShared.ts'

/**
 * The blended caster rows, as `vsmRenderCandidates` takes the opaque ones (same LOD test, same
 * candidate record): group 0 = that kernel's (0 params, 1 rows, 2 spheres, 3 mobility, 4 levels,
 * 5 candidates, 6 counters) and 7 the frame uniform (`rowFirst`). `params.rowCount` is the number
 * of blended rows.
 */
export const vsmTransmissionCandidatesWgsl = () =>
  wgslProgram(
    `@group(0) @binding(7) var<uniform> frame:VsmTransmissionFrame;
${vsmCandidatesKernel('vsmTransmissionCandidates', true)}`,
    [VSM_RENDER_ROWS_WGSL, FRAME_STRUCT_WGSL, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
  )

/** Group 0 of the clear: the VSM uniforms and the pool page info. */
export const VSM_TRANSMISSION_CLEAR_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'poolPageInfo', binding: 1 },
]

/**
 * The clear, one thread per physical page and slice, each slice's rule the page clear's: a slice
 * the VSM redraws this frame (its UNCACHED flag, the page referenced) is stamped, its record and
 * patch counts zero; it, or a slice of a page no longer allocated, gives its blocks back to the
 * pool, its table entry none, and is listed dirty (`vsmTransmissionNumber`, `headers`). No word of
 * a block is cleared: a block given back is read again only once written. Group 0: the VSM uniforms
 * and page metadata (`VSM_TRANSMISSION_CLEAR_SPECS`); group 1: 0 frame uniform, 1 build buffer,
 * 2 table, 3 pool, 4 links.
 */
export const vsmTransmissionClearWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(1) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(1) @binding(1) var<storage,read_write> build:array<atomic<u32>>;
fn vsmTransmissionRelease(index:u32,slice:u32){
 let flags=vsmPoolPageInfo[index].flags;
 let allocated=(flags&VSM_PAGE_WANTED)!=0u;
 let kept=(flags&VSM_META_UNSEEN)!=0u;
 // The slice's own flag (the static one when the cache keeps a static slice).
 let uncached=select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,slice==1u&&vsm.staticSlice==1u);
 let redrawn=allocated&&(flags&uncached)!=0u&&!kept;
 let key=2u*index+slice;
 if(redrawn){
  atomicStore(&build[VSM_T_STAMPS+key],frame.stamp);
  atomicStore(&build[VSM_T_COUNTS+key],0u);
  atomicStore(&build[VSM_T_PATCH+key],0u);
 }
 var b=table[key];
 if((redrawn||!allocated)&&b!=${NO_INDEX}u){
  table[key]=${NO_INDEX}u;
  for(var n=0u;n<VSM_T_CHAIN&&b<frame.blocks;n++){
   let at=atomicAdd(&pool[0],1u);
   atomicStore(&pool[2u+at],b);
   b=links[b];
  }
  if(!redrawn){atomicStore(&build[VSM_T_DIRTY+atomicAdd(&build[VSM_TC_DIRTY],1u)],key);}
 }
 if(redrawn){atomicStore(&build[VSM_T_DIRTY+atomicAdd(&build[VSM_TC_DIRTY],1u)],key);}
}
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionClear(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=vsm.poolPages){return;}
 vsmTransmissionRelease(id.x,0u);
 vsmTransmissionRelease(id.x,1u);
}
`,
    [
      VSM_CONSTANTS_WGSL,
      vsmBindingsWgsl(0, VSM_TRANSMISSION_CLEAR_SPECS, layout),
      frameWgsl(layout),
      transmissionTablesWgsl(1, 2),
    ],
  )
