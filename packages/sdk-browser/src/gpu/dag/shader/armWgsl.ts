/**
 * The cut's indirect dispatch arguments, armed inside its pass. Three lists have no bound the
 * layout knows — the previous frame's drawn journal, the candidates and the live clusters —, and
 * the kernels that fill them write each list's group count, x and y, in `work`. A kernel that
 * dispatches over a list reads its argument from `args`, a buffer the selection's group does not
 * bind: an indirect dispatch may not read a buffer the groups its pipeline uses bind writable, and
 * only this kernel's own group binds `args`, writable.
 *
 * Each run copies the three counts, one record each, `[x, y, 1]`: a record is read by the dispatch
 * that follows the run after its list was filled, and a record copied before its list is complete
 * is copied again before anything reads it. z has been one since the buffer was made. One lane per
 * list, one workgroup: a dispatch of the pass in place of a copy that cut it.
 */
export const DAG_ARM_SHADER = `@group(0) @binding(0) var<storage, read> work:array<u32>;
@group(0) @binding(1) var<storage, read_write> args:array<u32>;
override DRAWN_GROUPS:u32;
override CAND_GROUPS:u32;
override LIVE_GROUPS:u32;
@compute @workgroup_size(3) fn dagArm(@builtin(local_invocation_index) list:u32){
 var at=DRAWN_GROUPS;
 if(list==1u){at=CAND_GROUPS;}
 if(list==2u){at=LIVE_GROUPS;}
 args[list*3u]=work[at];
 args[list*3u+1u]=work[at+1u];
}`

/** Byte offset of each list's record in `args`: the order `dagArm` writes them in. */
export const DAG_ARGS = { drawn: 0, cand: 12, live: 24 } as const
/** `args` as made: three records, each one deep. */
export const DAG_ARGS_INITIAL = new Uint32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
