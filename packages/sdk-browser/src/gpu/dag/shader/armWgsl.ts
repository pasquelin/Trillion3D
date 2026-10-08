/**
 * The cut's indirect dispatch arguments, armed inside its pass. Six lists have no bound the layout
 * knows — the previous frame's drawn journal, the candidates, the live clusters, the two lists the
 * readout keeps (`differenceWgsl.ts`) and the journal a swap writes back (`swapWgsl.ts`) —, and the
 * kernels that fill or count them write each list's group count, x and y, in `work`. A kernel that
 * dispatches over a list reads its argument from `args`, a buffer the selection's group does not
 * bind: an indirect dispatch may not read a buffer the groups its pipeline uses bind writable, and
 * only this kernel's own group binds `args`, writable.
 *
 * Each run copies the six counts, one record each, `[x, y, 1]`: a record is read by the dispatch
 * that follows the run after its list was filled, and a record copied before its list is complete
 * is copied again before anything reads it. z has been one since the buffer was made. The drawn
 * journal holds one workgroup at least, as the lists armed by count do (`armList`): their first
 * thread writes what an empty list leaves too (a saved journal's length, a kept list's). One lane
 * per list, one workgroup: a dispatch of the pass in place of a copy that cut it.
 */
export const DAG_ARM_SHADER = `@group(0) @binding(0) var<storage, read> work:array<u32>;
@group(0) @binding(1) var<storage, read_write> args:array<u32>;
override DRAWN_GROUPS:u32;
override CAND_GROUPS:u32;
override LIVE_GROUPS:u32;
override LIST_GROUPS:u32;
@compute @workgroup_size(6) fn dagArm(@builtin(local_invocation_index) list:u32){
 var at=DRAWN_GROUPS;
 if(list==1u){at=CAND_GROUPS;}
 if(list==2u){at=LIVE_GROUPS;}
 if(list>=3u){at=LIST_GROUPS+2u*(list-3u);}
 let least=select(0u,1u,list==0u);
 args[list*3u]=max(work[at],least);
 args[list*3u+1u]=max(work[at+1u],least);
}`

/** Byte offset of each list's record in `args`: the order `dagArm` writes them in. */
export const DAG_ARGS = { drawn: 0, cand: 12, live: 24, list0: 36, list1: 48, restore: 60 } as const
/** `args` as made: six records, each one deep. */
export const DAG_ARGS_INITIAL = new Uint32Array(18).map((_, at) => (at % 3 === 2 ? 1 : 0))
