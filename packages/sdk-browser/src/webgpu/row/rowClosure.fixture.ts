import type { ClusterStructureIndex } from '../../page/selection/types.ts'
import { ROW_USE, ROW_USE_WORDS, ROW_WALK } from './rowWords.ts'

/** A placement as the closure reads it: its first packed page and its group structure. */
export type ClosurePlacement = { pageBase: number; structure?: ClusterStructureIndex }
/** A seed: a packed page a cut drew or asked for, its placement, the clock it is used at. */
export type ClosureSeed = { page: number; placement: number; value: number }

/**
 * The CPU twin of the rows' closure (`rowClosureWgsl.ts`), step for step: each seed stamps its own
 * row when its placement has no structure or its page no group; else its group is walked, the gate
 * the walk word of the first member holding a row, each member's row stamped, each output's owner
 * pushed — or the output stamped —, a walk stopping at a gate already as new. `use` holds
 * `ROW_USE_WORDS` words a row, raised in place; `rowOf` is the page→row map, -1 for none.
 */
export function closeRows(
  seeds: readonly ClosureSeed[],
  placements: readonly ClosurePlacement[],
  rowOf: (page: number) => number,
  use: Uint32Array,
) {
  const raise = (row: number, word: number, v: number) => {
    const at = row * ROW_USE_WORDS + word,
      old = use[at]
    use[at] = Math.max(old, v)
    return old
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
    const stack = [first]
    while (stack.length) {
      const g = stack.pop()!,
        end = s.childOffsets[g + 1]
      let m = s.childOffsets[g],
        gate = -1
      for (; m < end; m++) {
        gate = rowOf(pageBase + s.children[m])
        if (gate >= 0) {
          m++
          break
        }
      }
      if (gate >= 0) {
        if (raise(gate, ROW_WALK, v) >= v) continue
        raise(gate, ROW_USE, v)
      }
      for (; m < end; m++) stamp(pageBase + s.children[m], v)
      for (let o = s.outputOffsets[g]; o < s.outputOffsets[g + 1]; o++) {
        const output = s.outputs[o],
          owner = s.owners[output]
        if (owner < 0) stamp(pageBase + output, v)
        else stack.push(owner)
      }
    }
  }
}
