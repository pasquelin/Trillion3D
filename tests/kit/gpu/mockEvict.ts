import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts';
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts';
import { lastUseWord } from '../../../packages/sdk-browser/src/gpu/dag/shader/lastUseWgsl.ts';
import { canonicalPage, listEvictions } from '../../../packages/sdk-browser/src/gpu/dag/evict.ts';
import {
  SELECTION_HEADER_WORDS,
  evictionWord,
  keyBase,
  poolBase,
  residentWords,
  selectionListCap,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { words } from './mockComputeBlend.ts';

type Bound = Map<number, { data: Uint8Array }>;

/** The words a camera cut's last-use stamps and clock live in, as the kernel lays them out. */
function clockOf(byBinding: Bound, packed: PackedDag) {
  const flags = words(byBinding.get(DAG_BINDING.flags)!.data),
    work = words(byBinding.get(DAG_BINDING.work)!.data),
    cold = words(byBinding.get(DAG_BINDING.cold)!.data),
    frame = dagWorkLayout(Math.ceil(packed.pageCount / SELECTION_WORKGROUP)).frame,
    stampAt = (page: number) => lastUseWord(packed.nodeCount, packed.pageCount, page);
  return { flags, work, cold, frame, stampAt, keys: keyBase(packed.pageCount) };
}

/** `dagPrepare`'s `countFrame`, then `stampUse` on every page the camera cut drew or asked for:
 *  each stamp at its key's canonical page (`shader/lastUseWgsl.ts`). */
export function stampCameraCut(byBinding: Bound, packed: PackedDag, used: Iterable<number>) {
  const { flags, work, cold, frame, stampAt, keys } = clockOf(byBinding, packed);
  const now = ++work[frame];
  for (const page of used) flags[stampAt(canonicalPage(cold[keys + page]))] = now;
}

/** `dagListEvictions`, through its mirror: the queue behind the drawn list, bounded by `poolSlots`. */
export function listPoolEvictions(byBinding: Bound, packed: PackedDag, poolSlots: number) {
  const { flags, work, cold, frame, stampAt, keys } = clockOf(byBinding, packed);
  const pageCount = packed.pageCount,
    listCap = selectionListCap(pageCount),
    pool = poolBase(pageCount);
  const queue = listEvictions({
    pool: cold.subarray(pool, pool + residentWords(pageCount)),
    keys: cold.subarray(keys, keys + pageCount),
    stampOf: (page) => flags[stampAt(page)],
    now: work[frame],
    cap: Math.min(poolSlots, listCap),
  });
  const out = words(byBinding.get(DAG_BINDING.out)!.data),
    at = evictionWord(listCap);
  out[at] = queue.length;
  out.set(queue, at + SELECTION_HEADER_WORDS);
}
