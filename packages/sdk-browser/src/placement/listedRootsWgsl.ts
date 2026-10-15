/**
 * THE PROLOGUE OF A PASS OVER LISTED ROOTS (`rootListPass.ts`): its parameters as `passParams`
 * holds them — the roots, how many its list holds, whether it runs over every root — and the root a
 * thread takes. The composition's worlds, roots and motion passes, the root boxes pass and the
 * tree's leaves share it; each program declares its own `ranks`, the list it reads.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'

/** `params` at binding 0; `listedRank(g, n)`, thread `g`'s root — the `j`-th the list names, or root
 *  `j` when `whole` —, `NO_INDEX` past the list or the roots. */
export const LISTED_ROOTS_WGSL = wgslBlock(
  'LISTED_ROOTS_WGSL',
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, NO_INDEX],
  `struct Params{rootCount:u32,listed:u32,whole:u32,pad:u32,}
@group(0) @binding(0) var<uniform> params:Params;
fn listedRank(g:vec3u,n:vec3u)->u32{
 let j=flatIndex(g,n,WORKGROUP_THREADS);
 if(j>=params.listed){return NO_INDEX;}
 var rank=j;
 if(params.whole==0u){rank=ranks[j];}
 if(rank>=params.rootCount){return NO_INDEX;}
 return rank;
}`,
)
