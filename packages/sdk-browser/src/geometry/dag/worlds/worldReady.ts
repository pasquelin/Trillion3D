/**
 * WHEN A CELL OF THE WORLD IS LOADED AND MAY SWITCH (`worldFollow.ts`): whether an actor is one to
 * wait for, whether a cell is loaded, and whether its switch to visible or to invisible may go on
 * once the actors in it, or its own, have had their warm-up.
 *
 * An actor is one to wait for while it is built, wears a page or a row and its hold has not failed
 * for good; one not built, or failed, stands for nothing. An HLOD 0 cell is loaded once every cell
 * file of it is placed and its placements resident; a cell above it, once each actor of its
 * children is resident. A cell may turn visible once the actors in it — its children's — are
 * warmed up, and invisible once its own actor, when loaded, is: its parent visible, or none, the
 * actor always loaded.
 *
 * Cost: O(children of the cell) per question.
 */
import { CHAIN_ACTOR } from '../../../../../sdk-core/src/manifest/worldRoots.ts'
import type { PackedWorld } from './worldLinks.ts'
import type { createSwitchWarmth } from './worldWarm.ts'

/** What the readiness reads of the follower, per cell and instance: the words the partition told,
 *  what is visible, the actors' and the placements' residency counts; `below`, each cell's
 *  children; `bits`, the told bits it reads (`CELL_TOLD`): its cell files placed, its actor's hold
 *  failed. */
type ReadyState = {
  world: Pick<PackedWorld, 'actor' | 'layer' | 'parent' | 'rootsOf' | 'rowsOf'>
  below: readonly (readonly number[])[]
  told: Uint8Array
  visible: Uint8Array
  missing: Int32Array
  unready: Int32Array
  warmth: Pick<ReturnType<typeof createSwitchWarmth>, 'ready'>
  bits: { readonly placed: number; readonly failed: number }
}

/** The readiness of the cells of `state`. */
export function createCellReadiness(state: ReadyState) {
  const { world, below, told, visible, missing, unready, warmth, bits } = state
  const { actor, layer, parent, rootsOf, rowsOf } = world
  /** Whether cell `cell` at `base` has an actor to wait for. */
  const usable = (base: number, cell: number) =>
    (actor[cell] & CHAIN_ACTOR.built) !== 0 &&
    (rootsOf[cell].length > 0 || rowsOf[cell] > 0) &&
    (told[base + cell] & bits.failed) === 0
  return {
    /** Whether cell `cell` at `base` is loaded. */
    loaded(base: number, cell: number) {
      const at = base + cell
      if (layer[cell] === 0) return (told[at] & bits.placed) !== 0 && unready[at] === 0
      for (const child of below[cell])
        if (usable(base, child) && missing[base + child] !== 0) return false
      return true
    },
    /** Whether cell `cell` at `base` may turn visible: the actors in it warmed up, every one
     *  asked, none left for the next. */
    warmedIn(base: number, cell: number) {
      let ready = true
      for (const child of below[cell])
        if (usable(base, child)) ready = warmth.ready(base, child, cell, base + cell) && ready
      return ready
    },
    /** Whether cell `cell` at `base` may turn invisible: its own actor warmed up, when loaded. */
    warmedOut(base: number, cell: number) {
      const up = parent[cell]
      if (!usable(base, cell) || (up >= 0 && !visible[base + up])) return true
      return warmth.ready(base, cell, cell, base + cell)
    },
  }
}
