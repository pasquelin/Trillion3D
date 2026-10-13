import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'

/**
 * The ray query's parameters, one uniform both its kernels read: the rays and where their records,
 * their filter lists and their hits lie in the query's buffer; where the row table's index lies and
 * its mask; the visibility rows the index is made over; where the second residency bit set starts
 * (`../../gpu/dag/layout.ts`, `childBase`); the placement tree's top and where its member order lies
 * in the cold table, none without a tree; the placements the packing holds, and the world DAG's.
 */
export const RAY_PARAMS = fieldLayout('RayParams', [
  ['rays', 'u32'],
  ['rayWord', 'u32'],
  ['hitWord', 'u32'],
  ['filterWord', 'u32'],
  ['hashWord', 'u32'],
  ['hashMask', 'u32'],
  ['rows', 'u32'],
  ['childBase', 'u32'],
  ['treeRoot', 'u32'],
  ['members', 'u32'],
  ['placements', 'u32'],
  ['worldPlacement', 'u32'],
] as const)

/** The uniform, the query's buffer and the page table, as each kernel binds them in group `group`:
 *  the buffer atomic where the index is written (`atomic`), plain where it is read. */
export const rayQueryBindingsWgsl = (group: number, atomic: boolean) =>
  wgslBlock(
    `rayQueryBindingsWgsl(${group}, ${atomic})`,
    [PAGE_INFO_STRUCT_WGSL],
    `${RAY_PARAMS.wgsl}
@group(${group}) @binding(0) var<uniform> params:RayParams;
@group(${group}) @binding(1) var<storage,read_write> query:array<${atomic ? 'atomic<u32>' : 'u32'}>;
@group(${group}) @binding(2) var<storage,read> pages:array<PageInfo>;`,
  )

/** The slot a page's key is first tried at: a multiplicative hash, odd, so a run of pages spreads. */
const ROW_SLOT_WGSL = wgslBlock(
  'ROW_SLOT_WGSL',
  [],
  'fn rowSlot(page:u32)->u32{return (page*2654435761u)&params.hashMask;}',
)

/**
 * THE ROW OF A PAGE, ON THE GPU: the page table maps a row to the page it draws
 * (`PageInfo.selectionIndex`, `../row/pageRowWriter.ts`), and a ray met in the cut's hierarchy names
 * a page. The index the other way is made from the table as it stands, one thread a visibility row,
 * into an open-addressed table of `hashMask + 1` slots — twice the rows at least, cleared before —,
 * each slot the page plus one, then its row. A resident page the cut reads holds a row of its own
 * (`../row/pageState.ts`, `readsResident`), and a row one page: the index answers every page the
 * cut may draw, once, with the row whose words the rasters decode it from. Made at each batch of
 * rays, never kept: it costs a thread a row, and no copy of the table.
 */
export const ROW_HASH_SHADER = wgslProgram(
  `@compute @workgroup_size(64) fn insertRows(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let row=flatIndex(g,n,64u);
 if(row>=params.rows){return;}
 let key=pages[row].selectionIndex+1u;
 var slot=rowSlot(key-1u);
 for(var probe=0u;probe<=params.hashMask;probe++){
  let at=params.hashWord+2u*slot;
  let held=atomicCompareExchangeWeak(&query[at],0u,key);
  if(held.exchanged||held.old_value==key){atomicStore(&query[at+1u],row);return;}
  // Another page's slot: the next one. A weak exchange that failed on an empty slot tries it again.
  if(held.old_value!=0u){slot=(slot+1u)&params.hashMask;}
 }
}`,
  [FLAT_INDEX_WGSL, rayQueryBindingsWgsl(0, true), ROW_SLOT_WGSL],
)

/** The row of `page` in the index, `NO_ROW` when it holds none: the slots from its first on, up to
 *  an empty one. Reads `query` and `params` as the trace binds them. */
export const ROW_OF_PAGE_WGSL = wgslBlock(
  'ROW_OF_PAGE_WGSL',
  [ROW_SLOT_WGSL],
  `const NO_ROW:u32=0xffffffffu;
fn rowOfPage(page:u32)->u32{
 var slot=rowSlot(page);
 for(var probe=0u;probe<=params.hashMask;probe++){
  let at=params.hashWord+2u*slot;
  let key=query[at];
  if(key==page+1u){return query[at+1u];}
  if(key==0u){return NO_ROW;}
  slot=(slot+1u)&params.hashMask;
 }
 return NO_ROW;
}`,
)
