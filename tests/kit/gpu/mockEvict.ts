import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts'
import { dagFlagsWords } from '../../../packages/sdk-browser/src/gpu/dag/shader/lastUseWgsl.ts'
import * as L from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import {
  sortStaged,
  stagedPage,
  stagedRank,
  stagedRequest,
} from '../../../packages/sdk-browser/src/gpu/dag/request.fixture.ts'
import {
  ADMISSION_BUCKETS,
  ADMISSION_ERROR_BITS,
  REQUEST_AHEAD,
} from '../../../packages/sdk-browser/src/gpu/dag/request.ts'
import { words } from './mockBuffers.ts'
import { boundListCap } from './mockDag.ts'
import { listEvictions } from '../../../packages/sdk-browser/src/gpu/dag/evict.fixture.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { dagFlagShape } from '../../../packages/sdk-browser/src/gpu/dag/flagSections.ts'

/** The camera cut's last-use clock and `dagListEvictions`, replayed on the words the kernels read
 *  (`shader/lastUseWgsl.ts`, `shader/evictWgsl.ts`). */
export function mockEvictions(byBinding: Map<number, { data: Uint8Array }>, packed: PackedDag) {
  const [flags, work, cold, out] = (['flags', 'work', 'cold', 'out'] as const).map((name) =>
    words(byBinding.get(DAG_BINDING[name])!.data),
  )
  const { pageCount } = packed,
    frame = dagWorkLayout(ceilDiv(pageCount, SELECTION_WORKGROUP)).frame,
    shape = dagFlagShape(packed),
    stamps = dagFlagsWords(shape.queueWords, shape.candCap, 0),
    recordKeys = cold.subarray(L.recordKeyBase(pageCount)),
    keyWords = cold.subarray(L.keyWordBase(packed)),
    pool = L.poolBase(pageCount),
    listCap = boundListCap(byBinding)
  return {
    /** `countFrame`, then `stampUse` on each page the cut drew or asked for, at its content key. */
    stamp(used: Iterable<number>) {
      const now = ++work[frame]
      for (const page of used)
        flags[stamps + recordKeys[(page + packed.recordShift[packed.pageWorlds[page]]) >>> 0]] = now
    },
    /** The queue behind the drawn list, at most `EVICTION_BURST` entries. */
    list() {
      const queue = listEvictions({
        pool: cold.subarray(pool + 1, pool + 1 + cold[pool]),
        keyWords,
        stampOf: (key) => flags[stamps + key],
        now: work[frame],
        cap: L.EVICTION_BURST,
      })
      out[L.evictionWord(listCap)] = queue.length
      out.set(queue, L.evictionWord(listCap) + L.SELECTION_HEADER_WORDS)
    },
  }
}

/** `dagSortRequests`: the staged requests' pages into the sample, by rank, through the kernel's
 *  mirror; each waits as two words, its page then its priority. */
export function sortStagedRequests(byBinding: Map<number, { data: Uint8Array }>, listCap: number) {
  const ints = words(byBinding.get(DAG_BINDING.out)!.data),
    at = L.residentReadbackBytes(listCap) / 4,
    count = Math.min(ints[0], listCap)
  const staged = Array.from({ length: count }, (_, s) =>
    stagedRequest(ints[at + 2 * s], ints[at + 2 * s + 1]),
  )
  ints.set(sortStaged(staged).map(stagedPage), L.SELECTION_HEADER_WORDS)
  // Each admission bucket's count of the camera's requests (`levelCountsWord`).
  const counts = new Uint32Array(ADMISSION_BUCKETS)
  for (const word of staged) counts[(stagedRank(word) - REQUEST_AHEAD) >> ADMISSION_ERROR_BITS]++
  ints.set(counts, L.levelCountsWord(listCap))
}
