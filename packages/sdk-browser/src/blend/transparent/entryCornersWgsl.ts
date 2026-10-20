/**
 * THE TRANSPARENT ENTRIES' WORLD CORNERS ON THE GPU (`entryCorners.ts`): one thread an entry — every
 * entry of the table (`params.whole`), or those a list names —, its page's grown box carried by its
 * root's world as the GPU holds it in doubles (`../../placement/roots/rootWorlds.ts`), the eight corners
 * written as a row's are (`writeCorners`), each coordinate the single rounding then its residue. An
 * entry naming no page, or a page without a record, takes zero corners, which compaction drops.
 */
import { BOX_CORNERS_WGSL } from '../../placement/compose/gpuComposeDerivedWgsl.ts'
import { CORNER_VALUES } from '../../geometry/partition/gpu/contract.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { LISTED_AT_WGSL } from '../../placement/roots/listedRootsWgsl.ts'

/** Doubles of an entry's inputs: its grown box, then its root's rank and whether it holds a page,
 *  each one word of a double's two. */
export const ENTRY_INPUT_DOUBLES = 8
/** The entries pass's entry point. */
export const ENTRY_CORNERS_ENTRY = 'entryCorners'

export const ENTRY_CORNERS_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(2) var<storage,read> entryInputs:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> corners:array<u32>;
// The entries the list names (\`listedAt\`).
@group(0) @binding(4) var<storage,read> ranks:array<u32>;
fn deriveEntry(entry:u32){
 let at=entry*${ENTRY_INPUT_DOUBLES}u;
 let out=entry*${CORNER_VALUES}u;
 if(at+${ENTRY_INPUT_DOUBLES}u>arrayLength(&entryInputs)||out+${CORNER_VALUES}u>arrayLength(&corners)){return;}
 let rank=entryInputs[at+6u].x;
 if(entryInputs[at+7u].x==0u||rank>=params.rootCount){
  for(var k=0u;k<${CORNER_VALUES}u;k++){corners[out+k]=0u;}
  return;
 }
 var world:array<vec2u,16>;
 for(var k=0u;k<16u;k++){world[k]=rootWorlds[rank*16u+k];}
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var axis=0u;axis<3u;axis++){lo[axis]=entryInputs[at+axis];hi[axis]=entryInputs[at+3u+axis];}
 writeCorners(out,world,lo,hi);
}
@compute @workgroup_size(WORKGROUP_THREADS) fn entryCorners(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let j=flatIndex(g,n,WORKGROUP_THREADS);if(j>=params.listed){return;}
 deriveEntry(listedAt(j));
}`,
  [LISTED_AT_WGSL, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, BOX_CORNERS_WGSL],
)
