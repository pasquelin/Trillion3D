import type { ClusterStructureIndex } from '../../page/selection/types.ts'
import { ROW_USE, ROW_USE_WORDS, ROW_WALK } from './rowWords.ts'

/** A placement as the closure reads it: its first packed page and its group structure. */
export type ClosurePlacement = { pageBase: number; structure?: ClusterStructureIndex }
/** A seed: a packed page a cut drew or asked for, its placement, the clock it is used at. */
export type ClosureSeed = { page: number; placement: number; value: number }

/**
 * THE CONTRACT of the rows' closure (`rowClosureWgsl.ts`), not its steps: each seed raises to its
 * clock the use word of every row its readiness needs in its placement — its own row when its
 * placement has no structure or its page no group, else the rows of every group reachable from its
 * page's group, each output's owner reached in turn and an output no group replaces stamped alone
 * — and the walk word of each reached group's GATE, its first member holding a row. `use` holds
 * `ROW_USE_WORDS` words a row, raised in place, its walk words older than the seeds as every frame
 * leaves them; `rowOf` is the page→row map, -1 for none.
 */
export function closeRows(
  seeds: readonly ClosureSeed[],
  placements: readonly ClosurePlacement[],
  rowOf: (page: number) => number,
  use: Uint32Array,
) {
  const raise = (row: number, word: number, v: number) => {
    const at = row * ROW_USE_WORDS + word
    use[at] = Math.max(use[at], v)
  }
  const stamp = (page: number, v: number) => {
    const row = rowOf(page)
    if (row >= 0) raise(row, ROW_USE, v)
  }
  for (const { page, placement, value: v } of seeds) {
    const { pageBase, structure: s } = placements[placement]
    const first = s ? s.owners[page - pageBase] : -1
    if (!s || first < 0) {
      stamp(page, v)
      continue
    }
    // Breadth first over the groups reachable from the page's own.
    const reached = [first],
      seen = new Set(reached)
    for (let i = 0; i < reached.length; i++) {
      const g = reached[i]
      const members = Array.from(
        s.children.slice(s.childOffsets[g], s.childOffsets[g + 1]),
        (child) => pageBase + child,
      )
      const gate = members.find((member) => rowOf(member) >= 0)
      if (gate !== undefined) raise(rowOf(gate), ROW_WALK, v)
      for (const member of members) stamp(member, v)
      for (let o = s.outputOffsets[g]; o < s.outputOffsets[g + 1]; o++) {
        const output = s.outputs[o],
          owner = s.owners[output]
        if (owner < 0) stamp(pageBase + output, v)
        else if (!seen.has(owner)) {
          seen.add(owner)
          reached.push(owner)
        }
      }
    }
  }
}
