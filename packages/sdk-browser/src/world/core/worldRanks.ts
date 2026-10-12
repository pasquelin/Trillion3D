import type { Cut } from './worldCuts.ts'
import type { LoadedModel } from './loadedModel.ts'
import type { Primitive } from '../../../../sdk-core/src/index.ts'

/**
 * THE MESH RANKS OF A WORLD, GIVEN ONCE. A geometry resource and a loaded model each take their
 * rank, or block of ranks, the first time the world seats them, and keep it: a session opened
 * later reads the ranks the one before did, so what is added in place and what a fresh open reads
 * are the same manifest, ties between blended draws included.
 */
export function createWorldRanks() {
  const cuts = new WeakMap<Cut, number>(),
    models = new WeakMap<LoadedModel, number>(),
    primitives = new WeakMap<Cut, Primitive>()
  let next = 0
  const rankOf = (cut: Cut) => {
    let rank = cuts.get(cut)
    if (rank === undefined) cuts.set(cut, (rank = next++))
    return rank
  }
  return {
    /** The rank of the primitive of `cut`. */
    cut: rankOf,
    /** The primitive of `cut` at its rank: the one object a session opens on and the one a session
     *  already open is handed, its pages the resource's own. */
    primitive(cut: Cut) {
      let primitive = primitives.get(cut)
      if (!primitive) {
        primitives.set(cut, (primitive = { ...cut.runtime.primitive, mesh: rankOf(cut) }))
      }
      return primitive
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
