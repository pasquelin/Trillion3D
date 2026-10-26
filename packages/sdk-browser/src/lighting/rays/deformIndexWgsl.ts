import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { mixWord } from '../../../../math/src/wgsl/sampling.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { openProbeStatement } from '../../geometry/dag/shader/probeWgsl.ts'
import { VISIBLE_LAYOUT_WGSL } from '../../geometry/dag/visible/layout.ts'

/**
 * The ray query's parameters, one uniform its two kernels read (`rayQuery.ts`): the rays and where
 * their records, their filter lists and their hits lie in the query's buffer; where the record
 * table lies in it; where the deformation index lies and its mask, and the room of the decoded
 * clusters' table (`rows`) and the blended entries it is made over; the tree's top, none without a tree; the placements the packing holds.
 */
export const RAY_PARAMS = fieldLayout('RayParams', [
  ['rays', 'u32'],
  ['rayWord', 'u32'],
  ['hitWord', 'u32'],
  ['filterWord', 'u32'],
  ['recordWord', 'u32'],
  ['hashWord', 'u32'],
  ['hashMask', 'u32'],
  ['rows', 'u32'],
  ['entries', 'u32'],
  ['treeRoot', 'u32'],
  ['placements', 'u32'],
] as const)

/** Words of a slot of the deformation index: the page plus one, its results' word, its cluster's
 *  identifier base, and a pad. */
export const DEFORM_SLOT_WORDS = 4

/** The uniform and the query's buffer as a kernel binds them in group `group`: atomic where the
 *  deformation index is written (`atomic`), plain where it is read. */
export const rayQueryBindingsWgsl = (group: number, atomic: boolean) =>
  wgslBlock(
    `rayQueryBindingsWgsl(${group}, ${atomic})`,
    [],
    `${RAY_PARAMS.wgsl}
@group(${group}) @binding(0) var<uniform> params:RayParams;
@group(${group}) @binding(1) var<storage,read_write> query:array<${atomic ? 'atomic<u32>' : 'u32'}>;`,
  )

/** A step over the deform index from `page`'s slot (`openProbeStatement`), three words a slot. */
const deformProbe = (step: string) =>
  openProbeStatement({
    home: 'deformSlot(page)',
    mask: 'params.hashMask',
    slotWord: (s) => `params.hashWord+${DEFORM_SLOT_WORDS}u*${s}`,
    step,
  })

/** The slot a page's key is first tried at: the engine's word hash (`mixWord`), so a run of pages,
 *  or pages a stride apart, spreads. */
const DEFORM_SLOT_WGSL = wgslBlock(
  'DEFORM_SLOT_WGSL',
  [mixWord],
  'fn deformSlot(page:u32)->u32{return mixWord(page)&params.hashMask;}',
)

/**
 * WHERE THIS FRAME DEFORMED A PAGE, ON THE GPU. A deformed page's results lie where the one that
 * deforms it names them: its decoded cluster (`PageInfo.deformOutput`, `../../visibility/pageInfo.ts`)
 * or its blended span (`../../blend/transparent/spans.ts`), a placement's own block in the float pool
 * (`../../deformation/outputs.ts`). The index from a page to them is made from the clusters the
 * frame's decode wrote — the software ones from the bottom of the table, the hardware ones from its
 * top, as many as the list's header counts (`../../geometry/dag/visible/layout.ts`) — and the span
 * table as they stand, one thread a record, then an entry, into an open-addressed table of
 * `hashMask + 1` slots cleared before — each slot the page plus one, its results' word and its
 * cluster's identifier base (`DEFORM_SLOT_WORDS`). Only a deformed page takes a slot: every other page is
 * decoded from its record (`rayRecords.ts`), drawn or not. Made at each batch of rays, never kept.
 */
export const DEFORM_INDEX_SHADER = wgslProgram(
  `@group(0) @binding(2) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage,read> entries:array<u32>;
@group(0) @binding(4) var<storage,read> spans:array<u32>;
@group(0) @binding(5) var<storage,read> visible:array<u32>;
fn insertDeformed(page:u32,output:u32,base:u32){
${deformProbe(`// Another page's slot: the next one. A weak exchange that failed on an empty slot tries it again.
  loop{
   let held=atomicCompareExchangeWeak(&query[at],0u,page+1u);
   if(held.exchanged||held.old_value==page+1u){atomicStore(&query[at+1u],output);atomicStore(&query[at+2u],base);return;}
   if(held.old_value!=0u){break;}
  }`)}
}
// Whether record \`i\` of the decoded clusters' table was written by the frame's decode: the software
// records from the bottom, the hardware ones from the top, as many as the list's header counts, both
// counted past the room too (the cut's own bounds, \`heldSoftware\`, \`heldHardware\`). A record
// past them is the table's older content.
fn clusterWritten(i:u32)->bool{
 let software=min(visible[VIS_SW],params.rows);
 let hardware=min(visible[VIS_HW],params.rows-software);
 return i<software||i>=params.rows-hardware;
}
@compute @workgroup_size(WORKGROUP_THREADS) fn indexDeformed(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,WORKGROUP_THREADS);
 if(i<params.rows){
  if(clusterWritten(i)){
   let row=pages[i];
   if(row.deformOutput!=0u){insertDeformed(row.selectionIndex,row.deformOutput,row.packedBase);}
  }
  return;
 }
 let e=i-params.rows;
 if(e>=params.entries){return;}
 let page=entries[e];
 // A span drawn and deformed: its corners, then its results' word (\`writeSpanDeformation\`).
 if(page!=NO_INDEX&&spans[e*4u+1u]!=0u&&spans[e*4u+2u]!=0u){insertDeformed(page,spans[e*4u+2u],0u);}
}`,
  [
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    PAGE_INFO_STRUCT_WGSL,
    VISIBLE_LAYOUT_WGSL,
    NO_INDEX,
    rayQueryBindingsWgsl(0, true),
    DEFORM_SLOT_WGSL,
  ],
)

/** Where this frame deformed `page`: its results' word and its row's identifier base, or zeros —
 *  a page nothing deforms is read as its record holds it. Reads `query` and `params` as the trace
 *  binds them. */
export const DEFORMED_OF_PAGE_WGSL = wgslBlock(
  'DEFORMED_OF_PAGE_WGSL',
  [DEFORM_SLOT_WGSL],
  `fn deformedOf(page:u32)->vec2u{
${deformProbe(`let key=query[at];
  if(key==0u){return vec2u(0u);}
  if(key==page+1u){return vec2u(query[at+1u],query[at+2u]);}`)}
 return vec2u(0u);
}`,
)
