/**
 * The backend of the cut rule's tests that holds residency on the host (`./held.fixture.ts`): the CPU cut,
 * over placements of the synthetic DAG. It names to its pool's feed the pages whose residency
 * flipped, as the WebGPU rank journal does, and counts the residency answers its cuts asked for.
 */
import { selectVisiblePages } from './cut.fixture.ts'
import type { SelectionResult } from './result.ts'
import { createHeldResidency, type HeldResidency } from './held.fixture.ts'
import { postPackedBases, type PlacementIndex } from '../selection/placements.ts'
import { placements, stripCamera } from './cutRuleBackends.fixture.ts'
import type { RuleDag } from './cutRule.fixture.ts'
import type { ClusterRoot, PageRec } from '../selection/types.ts'

/** The packed rank of each record: the DAG fixture's pages are unique per placement. */
function ranksOf(roots: readonly ClusterRoot<PageRec>[], placement: PlacementIndex) {
  const rank = new Map<PageRec, number>()
  for (let r = 0; r < roots.length; r++)
    for (let p = 0; p < roots[r].pages.length; p++)
      rank.set(roots[r].pages[p], placement.baseOfRoot[r] + p)
  return rank
}

/** A backend over `roots`' pool: each frame `load`s the pages whose residency flipped, names each
 *  to the feed, then cuts with `cutOf`; `reads` counts the residency answers its cuts asked for. */
function hostBackend(
  roots: ClusterRoot<PageRec>[],
  held: HeldResidency,
  placement: PlacementIndex,
  load: (page: PageRec, rank: number, resident: boolean) => void,
  cutOf: () => SelectionResult<PageRec>,
  reads: () => number,
) {
  const rank = ranksOf(roots, placement),
    pages = roots.flatMap((root) => root.pages),
    now = new Uint8Array(pages.length)
  held.track(roots)
  const frame = (resident: Uint8Array) => {
    pages.forEach((page, at) => {
      if (now[at] === resident[at]) return
      now[at] = resident[at]
      const packed = rank.get(page)!
      load(page, packed, resident[at] === 1)
      held.moved(packed, page)
    })
    const result = cutOf()
    return {
      drawn: Array.from(result.shownPacked.subarray(0, result.shown.length)),
      wanted: Array.from(result.wantedPacked.subarray(0, result.wanted.length)),
    }
  }
  return Object.assign(frame, { held, reads })
}

/** The CPU cut (`./cut.fixture.ts`) with the host answering for residency, as the WebGPU CPU path asks it: the rule on `./held.fixture.ts`'s readiness, its descent pruned on the open counts. */
export function cpuBackend(
  dag: RuleDag,
  threshold: number,
  roots = placements(dag, 1),
  /** Root rank the feed cannot route, simulating a layout that posts no base for it: its moves
   *  are read whole at every visit, and `unroutedReads` counts them. */
  unrouted = -1,
) {
  const cam = stripCamera(dag),
    on: boolean[] = []
  const placement = postPackedBases(roots),
    rank = ranksOf(roots, placement)
  if (unrouted >= 0) placement.baseOfRoot[unrouted] = -1
  let reads = 0
  const isResident = (page: PageRec) => (reads++, on[rank.get(page)!] === true)
  const options = {
    pixelError: threshold,
    viewport: [1280, 720] as [number, number],
    held: createHeldResidency({ isResident }, placement),
  }
  const load = (_page: PageRec, packed: number, resident: boolean) => void (on[packed] = resident)
  const cut = () => selectVisiblePages(roots, cam, options)
  return hostBackend(roots, options.held, placement, load, cut, () => reads)
}
