import type { Cut } from './worldCuts.ts'
import type { LoadedModel } from './loadedModel.ts'

/**
 * THE MESH RANKS OF A WORLD, GIVEN ONCE. A geometry resource and a loaded model each take their
 * rank, or block of ranks, the first time the world seats them, and keep it: a session opened
 * later reads the ranks the one before did, so what is added in place and what a fresh open reads
 * are the same manifest, ties between blended draws included.
 */
export function createWorldRanks() {
  const cuts = new WeakMap<Cut, number>(),
    models = new WeakMap<LoadedModel, number>()
  let next = 0
  return {
    /** The rank of the primitive of `cut`. */
    cut(cut: Cut) {
      let rank = cuts.get(cut)
      if (rank === undefined) cuts.set(cut, (rank = next++))
      return rank
    },
    /** The first rank of `model`'s block; `span` its meshes' ranks past it, read at its first
     *  seat only. */
    model(model: LoadedModel, span: () => number) {
      let first = models.get(model)
      if (first === undefined) {
        models.set(model, (first = next))
        next += span()
      }
      return first
    },
  }
}

/** The ranks of a world (`createWorldRanks`). */
export type WorldRanks = ReturnType<typeof createWorldRanks>
