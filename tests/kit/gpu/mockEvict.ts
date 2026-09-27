import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts';
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts';
import { dagFlagsWords } from '../../../packages/sdk-browser/src/gpu/dag/shader/lastUseWgsl.ts';
import { canonicalPage, listEvictions } from '../../../packages/sdk-browser/src/gpu/dag/evict.ts';
import * as L from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { words } from './mockComputeBlend.ts';

/** The camera cut's last-use clock and `dagListEvictions`, replayed on the words the kernels read
 *  (`shader/lastUseWgsl.ts`, `shader/evictWgsl.ts`). */
export function mockEvictions(byBinding: Map<number, { data: Uint8Array }>, packed: PackedDag) {
  const [flags, work, cold, out] = (['flags', 'work', 'cold', 'out'] as const).map((name) =>
    words(byBinding.get(DAG_BINDING[name])!.data),
  );
  const { pageCount } = packed,
    frame = dagWorkLayout(Math.ceil(pageCount / SELECTION_WORKGROUP)).frame,
    stamps = dagFlagsWords(packed.nodeCount, pageCount, false),
    keys = cold.subarray(L.keyBase(pageCount)),
    pool = L.poolBase(pageCount),
    listCap = L.selectionListCap(pageCount);
  return {
    /** `countFrame`, then `stampUse` on each page the cut drew or asked for, at its canonical page. */
    stamp(used: Iterable<number>) {
      const now = ++work[frame];
      for (const page of used) flags[stamps + canonicalPage(keys[page])] = now;
    },
    /** The queue behind the drawn list, at most `EVICTION_BURST` entries. */
    list() {
      const queue = listEvictions({
        pool: cold.subarray(pool + 1, pool + 1 + cold[pool]),
        keys,
        stampOf: (page) => flags[stamps + page],
        now: work[frame],
        cap: L.EVICTION_BURST,
      });
      out[L.evictionWord(listCap)] = queue.length;
      out.set(queue, L.evictionWord(listCap) + L.SELECTION_HEADER_WORDS);
    },
  };
}
