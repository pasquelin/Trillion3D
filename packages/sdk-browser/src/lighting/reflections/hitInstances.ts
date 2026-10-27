import type { TrackedRoot } from '../distanceField/objectTable.ts'

/**
 * THE TABLE FROM AN OBJECT OF THE GLOBAL FIELD'S OBJECT GRID TO ITS PLACEMENT IN THE SURFACE CACHE, as
 * the words a hit reads (`../surfaceCache/hitWgsl.ts`, `scHitPlacement`): the first word the instances it holds, then the
 * placement's number — the cache's own, which names its mesh cards to the tables (`scPlacementMeshCards`) — of
 * each instance, `NO_PLACEMENT` for an instance with none.
 *
 * An object of the grid is named by the instance of its record (`ObjectSource.instance`): the rank of its root
 * among the roots the field's scene placed — or, for the stand-in of an HLOD cell's actors, the rank of the
 * root of the world DAG it stands for. The cache follows those very roots (`placements.ts`), so a placement's
 * instance is read off its roots: every root that stands as it does, one for each primitive of a mesh, is told
 * its placement, so that a hit of the scene's triangles, which names the root of the primitive it met
 * (`../rays/sceneTrace/`: its rank among the cut's roots, which lead the list the cache follows, in order), finds the cards as a hit of the field does. The several stand-ins of one world DAG's root share its instance: an
 * instance that several placements answer to is told no placement — the hit finds no cards there and the field
 * answers it — until the grid's objects are named apart.
 */

/** The word of an instance with no placement of the cache. */
const NO_PLACEMENT = 0xffffffff

/** The word of an instance that several placements answer to, while the table is made: none in the end. */
const SEVERAL = 0xfffffffe

/** The table of the placements `ids` — each followed by the roots `rootsOf` says — by the instance `rankOf` says of a root, none for
 *  a root the field's scene does not hold: written in `scratch`, or in a larger array where it does not fit. Its
 *  words are the first `1 + words[0]` of the array returned. */
export function instanceWords(
  ids: Iterable<number>,
  rootsOf: (placement: number) => Iterable<TrackedRoot>,
  rankOf: (root: TrackedRoot) => number | undefined,
  scratch: Uint32Array<ArrayBuffer>,
): Uint32Array<ArrayBuffer> {
  let words = scratch.length ? scratch : new Uint32Array(16)
  let end = 0
  words.fill(NO_PLACEMENT, 1)
  for (const placement of ids) {
    for (const root of rootsOf(placement)) {
      const instance = root.standsFor ?? rankOf(root)
      if (instance === undefined) continue
      if (instance + 2 > words.length) {
        const grown = new Uint32Array(Math.max(16, 2 * (instance + 2)))
        grown.fill(NO_PLACEMENT, 1)
        grown.set(words.subarray(0, end + 1))
        words = grown
      }
      const told = words[1 + instance]
      words[1 + instance] = told === NO_PLACEMENT || told === placement ? placement : SEVERAL
      end = Math.max(end, instance + 1)
    }
  }
  for (let at = 1; at <= end; at++) if (words[at] === SEVERAL) words[at] = NO_PLACEMENT
  words[0] = end
  return words
}
