import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts'
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
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
import { words } from './fakeBuffers.ts'
import { boundListCap } from './fakeDag.ts'
import {
  aheadClock,
  listEvictions,
  pageKeys,
  raiseGroups,
} from '../../../packages/sdk-browser/src/gpu/dag/evict.fixture.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'

/** The groups' last uses and `dagListEvictions`, replayed on the words the kernels read
 *  (`shader/lastUseWgsl.ts`, `shader/evictWgsl.ts`): the clock is the frame the camera's uniform
 *  block carries, the words live in `work`. */
export function fakeEvictions(byBinding: Map<number, { data: Uint8Array }>, packed: PackedDag) {
  const [work, cold, out, views] = (['work', 'cold', 'out', 'views'] as const).map((name) =>
    words(byBinding.get(DAG_BINDING[name])!.data),
  )
  const layout = dagWorkLayout(ceilDiv(packed.pageCount, SELECTION_WORKGROUP), packed.groupCount),
    lastUse = work.subarray(layout.lastUse, layout.lastUse + packed.groupCount),
    now = views[viewWord('frame')],
    keys = pageKeys(packed),
    pool = L.poolBase(packed.pageCount),
    listCap = boundListCap(byBinding)
  return {
    /** `stampUse` on each page the cut drew or asked for, `stampAhead` on those the view ahead
     *  asked for, and `dagRaiseParents`, at once. */
    stamp(used: Iterable<number>, ahead: Iterable<number> = []) {
      raiseGroups(lastUse, keys.groups, [...ahead].map(keys.groupOf), aheadClock(now))
      raiseGroups(lastUse, keys.groups, [...used].map(keys.groupOf), now)
    },
    /** The queue behind the drawn list, at most `EVICTION_BURST` entries, its old head counted. */
    list() {
      const { queue, old } = listEvictions({
        pool: cold.subarray(pool + 1, pool + 1 + cold[pool]),
        keyWords: keys.keyWords,
        useOf: (key) => lastUse[keys.groups.keyGroups[key]],
        now,
        cap: L.EVICTION_BURST,
      })
      out[L.evictionWord(listCap)] = queue.length
      out[L.evictionWord(listCap) + 1] = old
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
