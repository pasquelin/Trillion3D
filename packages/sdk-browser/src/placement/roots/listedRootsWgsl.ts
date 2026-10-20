/**
 * THE PROLOGUE OF A PASS OVER LISTED ROOTS (`rootListPass.ts`): its parameters as `passParams`
 * holds them — the roots, how many its list holds, whether it runs over every root — and the root a
 * thread takes. The composition's worlds, roots and motion passes, the root boxes pass and the
 * tree's leaves share it, the transparent entries pass its parameters and `listedAt`; each program
 * declares its own `ranks`, the list it reads.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'

/** `params` at binding 0; `listedAt(j)`, the pass's `j`-th entry — the `j`-th its `ranks` names, or
 *  `j` when `whole` —, for `j` below `params.listed`. */
export const LISTED_AT_WGSL = wgslBlock(
  'LISTED_AT_WGSL',
  [],
  `struct Params{rootCount:u32,listed:u32,whole:u32,pad:u32,}
@group(0) @binding(0) var<uniform> params:Params;
fn listedAt(j:u32)->u32{
 if(params.whole==0u){return ranks[j];}
 return j;
}`,
)

/** `listedRank(g, n)`, thread `g`'s root (`listedAt`), `NO_INDEX` past the list or the roots. */
export const LISTED_ROOTS_WGSL = wgslBlock(
  'LISTED_ROOTS_WGSL',
  [LISTED_AT_WGSL, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL, NO_INDEX],
  `fn listedRank(g:vec3u,n:vec3u)->u32{
 let j=flatIndex(g,n,WORKGROUP_THREADS);
 if(j>=params.listed){return NO_INDEX;}
 let rank=listedAt(j);
 if(rank>=params.rootCount){return NO_INDEX;}
 return rank;
}`,
)
