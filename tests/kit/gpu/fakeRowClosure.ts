// The rows' closure (`webgpu/row/rowClosureWgsl.ts`) on the fake device: each cut the double
// evaluates (`dagMask`) leaves its seeds — the pages it drew and asked at its clock, those asked
// ahead at the clock ahead —, and the closure's dispatch raises the use words of every row their
// readiness needs, by the closure's contract (`closeRows`), on the map and the use words its own
// group binds. The rows' victim sort then ranks what the GPU's would (`fakePoolSorts.ts`).
import {
  closeRows,
  type ClosurePlacement,
  type ClosureSeed,
} from '../../../packages/sdk-browser/src/webgpu/row/rowClosure.fixture.ts'
import { rowOfPageIn } from '../../../packages/sdk-browser/src/webgpu/row/rowMap.fixture.ts'
import { ROW_CLOSURE_BINDING } from '../../../packages/sdk-browser/src/webgpu/row/rowClosureWgsl.ts'
import { rootOfPacked } from '../../../packages/sdk-browser/src/page/selection/placements.ts'
import { EVICT_IN_USE } from '../../../packages/sdk-browser/src/gpu/pool/rank.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import { boundWords, type BoundBuffer } from './fakeBuffers.ts'

/** The seeds of the last cut evaluated and its placements, until a closure takes them. */
let held: { seeds: ClosureSeed[]; placements: readonly ClosurePlacement[] } | undefined

/** The cut of `dag` at clock `frame` drew `drawn`, asked `asked` and `ahead`: its seeds, held. */
export function noteCutSeeds(
  dag: PackedDag,
  frame: number,
  cut: { drawn: readonly number[]; asked: readonly number[]; ahead: readonly number[] },
) {
  const ahead = Math.max(frame, EVICT_IN_USE) - EVICT_IN_USE
  // A page whose placement lays no links — a DAG read back off the bindings
  // (`packedFromBindings`) — closes over itself alone.
  const placements: ClosurePlacement[] = [...dag.cutLinks, { pageBase: 0 }],
    alone = placements.length - 1
  const seed = (value: number) => (page: number) => {
    const w = rootOfPacked(dag.pageIndex, page)
    return { page, placement: w >= 0 && dag.cutLinks[w] ? w : alone, value }
  }
  held = {
    seeds: [
      ...cut.drawn.map(seed(frame)),
      ...cut.asked.map(seed(frame)),
      ...cut.ahead.map(seed(ahead)),
    ],
    placements,
  }
}

/** The closure's kernels (`ROW_CLOSURE_STAGES`): the first of a cut's two raises every use word
 *  its seeds need, the second finds them taken. */
export const ROW_CLOSURE_KERNELS: ReadonlySet<string> = new Set(['rowCloseAsked', 'rowCloseDrawn'])

/** A closure dispatch on the rows' group `entries`: the held cut's seeds closed over its rows. */
export function replayRowClosure(entries: readonly BoundBuffer[]) {
  if (!held) return
  const map = boundWords(entries, ROW_CLOSURE_BINDING.rowMap),
    use = boundWords(entries, ROW_CLOSURE_BINDING.rowUse)
  closeRows(held.seeds, held.placements, (page) => rowOfPageIn(map, page), use)
  held = undefined
}
