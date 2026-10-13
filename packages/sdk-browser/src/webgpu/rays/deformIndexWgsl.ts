import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'

/**
 * The ray query's parameters, one uniform slot a dispatch (`rayQuery.ts`): the rays and where their
 * records, their filter lists and their hits lie in the query's buffer; where the record table and
 * the placement tree's member order lie in it; where the deformation index lies and its mask, and
 * the rows and the blended entries it is made over; the tree's top, none without a tree; the
 * placements the packing holds and the world DAG's; the range of placements this dispatch reads,
 * and whether it carries the hits an earlier range left.
 */
export const RAY_PARAMS = fieldLayout('RayParams', [
  ['rays', 'u32'],
  ['rayWord', 'u32'],
  ['hitWord', 'u32'],
  ['filterWord', 'u32'],
  ['recordWord', 'u32'],
  ['memberWord', 'u32'],
  ['hashWord', 'u32'],
  ['hashMask', 'u32'],
  ['rows', 'u32'],
  ['entries', 'u32'],
  ['treeRoot', 'u32'],
  ['placements', 'u32'],
  ['worldPlacement', 'u32'],
  ['rangeFirst', 'u32'],
  ['rangeCount', 'u32'],
  ['carry', 'u32'],
] as const)

/** Words of a slot of the deformation index: the page plus one, its results' word, its row's
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

/** The slot a page's key is first tried at: a multiplicative hash, odd, so a run of pages spreads. */
const DEFORM_SLOT_WGSL = wgslBlock(
  'DEFORM_SLOT_WGSL',
  [],
  'fn deformSlot(page:u32)->u32{return (page*2654435761u)&params.hashMask;}',
)

/**
 * WHERE THIS FRAME DEFORMED A PAGE, ON THE GPU. A deformed page's results lie where the one that
 * deforms it names them: its visibility row (`PageInfo.deformOutput`, `../row/pageRowWriter.ts`) or
 * its blended span (`../transparent/spans.ts`), a placement's own block in the float pool
 * (`../../deformation/outputs.ts`). The index from a page to them is made from the row table and
 * the span table as they stand, one thread a row, then an entry, into an open-addressed table of
 * `hashMask + 1` slots cleared before — each slot the page plus one, its results' word and its row's
 * identifier base (`DEFORM_SLOT_WORDS`). Only a deformed page takes a slot: every other page is
 * decoded from its record (`rayRecords.ts`), drawn or not. Made at each batch of rays, never kept.
 */
export const DEFORM_INDEX_SHADER = wgslProgram(
  `@group(0) @binding(2) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage,read> entries:array<u32>;
@group(0) @binding(4) var<storage,read> spans:array<u32>;
fn insertDeformed(page:u32,output:u32,base:u32){
 var slot=deformSlot(page);
 for(var probe=0u;probe<=params.hashMask;probe++){
  let at=params.hashWord+${DEFORM_SLOT_WORDS}u*slot;
  let held=atomicCompareExchangeWeak(&query[at],0u,page+1u);
  if(held.exchanged||held.old_value==page+1u){atomicStore(&query[at+1u],output);atomicStore(&query[at+2u],base);return;}
  // Another page's slot: the next one. A weak exchange that failed on an empty slot tries it again.
  if(held.old_value!=0u){slot=(slot+1u)&params.hashMask;}
 }
}
@compute @workgroup_size(64) fn indexDeformed(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(g,n,64u);
 if(i<params.rows){
  let row=pages[i];
  if(row.deformOutput!=0u){insertDeformed(row.selectionIndex,row.deformOutput,row.packedBase);}
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
    PAGE_INFO_STRUCT_WGSL,
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
 var slot=deformSlot(page);
 for(var probe=0u;probe<=params.hashMask;probe++){
  let at=params.hashWord+${DEFORM_SLOT_WORDS}u*slot;
  let key=query[at];
  if(key==page+1u){return vec2u(query[at+1u],query[at+2u]);}
  if(key==0u){return vec2u(0u);}
  slot=(slot+1u)&params.hashMask;
 }
 return vec2u(0u);
}`,
)
