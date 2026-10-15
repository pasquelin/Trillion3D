import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/** The arming group's bindings in group 0: past every binding of the selection's (`bindings.ts`). */
export const DAG_ARM_BINDING = { work: 10, args: 11 } as const

/**
 * The cut's indirect dispatch arguments, armed inside its pass. Ten lists have no bound the layout
 * knows — the previous frame's drawn journal, the candidates, the live clusters, the two lists the
 * readout keeps (`differenceWgsl.ts`), the journal a swap writes back (`swapWgsl.ts`), the three
 * descent queues (`levelWgsl.ts`) and the pool's list the eviction sorts (`evictWgsl.ts`,
 * `armPoolSort`) —, and the kernels that fill or count them write each list's group count, x and
 * y, in `work` (`armGroups`, `openSlice`). A kernel that
 * dispatches over a list reads its argument from `args`, a buffer the selection's group does not
 * bind: an indirect dispatch may not read a buffer the groups its pipeline uses bind writable, and
 * only this kernel's own group binds `args`, writable.
 *
 * Each run copies the ten counts, one record each, `[x, y, 1]`: a record is read by the dispatch
 * that follows the run after its list was filled, and a record copied before its list is complete
 * is copied again before anything reads it. z has been one since the buffer was made. The drawn
 * journal holds one workgroup at least, as the lists armed by count do (`armList`): their first
 * thread writes what an empty list leaves too (a saved journal's length, a kept list's); so does a
 * queue, whose first thread clears the queue the level after next fills. One lane per list, one
 * workgroup: a dispatch of the pass in place of a copy that cut it.
 *
 * An entry point of the cut's module (`shader.ts`), compiled in the batch of its stages
 * (`../stages.ts`): it never waits behind a compile asked after them. Its group is its own, at
 * bindings the selection's group leaves free (`DAG_ARM_BINDING`), and its list words are the
 * pipeline's overrides, which no other stage reads.
 */
/** The lists `dagArm` arms, in the order of their records in `args`: its lanes, one a list. The
 *  kept lists, the restored journal, the descent queues and the pool's lie in `work` in this order
 *  from `LIST_GROUPS` (`lastUseWgsl.ts`, `listGroups`). */
const ARMED = [
  'drawn',
  'cand',
  'live',
  'list0',
  'list1',
  'restore',
  'queue0',
  'queue1',
  'queue2',
  'pool',
] as const
/** Bytes of one indirect record: x, y, z. */
const RECORD_BYTES = 12
const recordOf = (list: (typeof ARMED)[number]) => ARMED.indexOf(list) * RECORD_BYTES
const FIRST_LISTED = ARMED.indexOf('list0'),
  FIRST_QUEUE = ARMED.indexOf('queue0'),
  POOL = ARMED.indexOf('pool')

export const DAG_ARM_WGSL = wgslBlock(
  'DAG_ARM_WGSL',
  [],
  `@group(0) @binding(${DAG_ARM_BINDING.work}) var<storage, read> armWork:array<u32>;
@group(0) @binding(${DAG_ARM_BINDING.args}) var<storage, read_write> armArgs:array<u32>;
override DRAWN_GROUPS:u32;
override CAND_GROUPS:u32;
override LIVE_GROUPS:u32;
override LIST_GROUPS:u32;
@compute @workgroup_size(${ARMED.length}) fn dagArm(@builtin(local_invocation_index) list:u32){
 var at=DRAWN_GROUPS;
 if(list==${recordOf('cand') / RECORD_BYTES}u){at=CAND_GROUPS;}
 if(list==${recordOf('live') / RECORD_BYTES}u){at=LIVE_GROUPS;}
 if(list>=${FIRST_LISTED}u){at=LIST_GROUPS+2u*(list-${FIRST_LISTED}u);}
 let least=select(0u,1u,list==${recordOf('drawn') / RECORD_BYTES}u||(list>=${FIRST_QUEUE}u&&list<${POOL}u));
 armArgs[list*3u]=max(armWork[at],least);
 armArgs[list*3u+1u]=max(armWork[at+1u],least);
}`,
)

/** Byte offset of each list's record in `args`: the order `dagArm` writes them in (`ARMED`). */
export const DAG_ARGS = {
  drawn: recordOf('drawn'),
  cand: recordOf('cand'),
  live: recordOf('live'),
  list0: recordOf('list0'),
  list1: recordOf('list1'),
  restore: recordOf('restore'),
  /** The descent queues', one record each (`levelWgsl.ts`, `queueGroups`). */
  queues: [recordOf('queue0'), recordOf('queue1'), recordOf('queue2')],
  /** The pool sort's per-group stages (`../../pool/sort.ts`), armed for the pool list's count by
   *  `dagPrepare` (`evictWgsl.ts`, `armPoolSort`): no workgroup for an empty list. */
  pool: recordOf('pool'),
} as const
/** `args` as made: a record a list, each one deep, none of them a workgroup yet. */
export const DAG_ARGS_INITIAL = new Uint32Array(ARMED.length * 3).map((_, at) =>
  at % 3 === 2 ? 1 : 0,
)
