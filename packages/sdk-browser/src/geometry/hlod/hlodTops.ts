/**
 * THE ACTORS ALWAYS LOADED OF AN HLOD CHAIN: those no cell holds — a chain's top, or an actor
 * built by a layer not spatially loaded (`src/hlod/cells.rs`). The actors always loaded of one
 * level lie together, so they make one unit of it, as the actors a cell holds do
 * (`hlodCells.ts`): it waits to load in the partition's one load order (`LoadSlots`), after every
 * cell a view reaches — none reaches it, so nothing else ranks it (`LoadingCell.always`) —, starts
 * while room is left and takes none, and is loading until every actor of it is held and landed;
 * its actors are loaded from the moment it starts, whatever the view. Its key lies past the
 * chain's cells'.
 *
 * Cost: O(C) once at creation for C cells of the chain, O(L) a frame for L levels.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import type { LoadingCell, LoadSlots } from '../partition/loadSlots.ts'
import { CHAIN_ACTOR } from '../../../../sdk-core/src/manifest/worldRoots.ts'
import { appendTo } from '../../../../math/src/sequence/counts.ts'

/** What ranks a unit of the actors always loaded in the load order: nothing but `always`. */
const ALWAYS = { extent: 0, level: 0, priority: 0, distance: 0, raw: 0, always: true }

/** The units of the actors always loaded of `chain`, each loading as `slots` says: `landed` tells
 *  whether the actor of a cell is held and landed, `weigh` that its load may have moved. */
export function createTops(
  chain: NonNullable<WorldRootsHold['table']>['chain'] | undefined,
  slots: Pick<LoadSlots, 'loads'>,
  landed: (cell: number) => boolean,
  weigh: (cell: number) => void,
) {
  const count = chain?.parent.length ?? 0
  /** The cells whose actors are always loaded, by the level of their actors, and the levels whose
   *  turn has come. */
  const levels = new Map<number, number[]>(),
    started = new Set<number>()
  for (let cell = 0; cell < count; cell++)
    if (chain!.parent[cell] < 0 && chain!.actor[cell] & CHAIN_ACTOR.built)
      appendTo(levels, chain!.actorLevel[cell], cell)
  return {
    /** The key of the unit `cell`'s actor, always loaded, belongs to: past the chain's cells. */
    key: (cell: number) => count + chain!.actorLevel[cell],
    /** Whether `cell`'s actor, always loaded, is loaded: its unit's turn has come. */
    opened: (cell: number) => started.has(chain!.actorLevel[cell]),
    /** The units not whole, onto `out`: those waiting for their turn and those loading. */
    waiting(out: LoadingCell[]) {
      for (const [level, cells] of levels)
        if (!started.has(level) || !cells.every(landed)) out.push({ key: count + level, ...ALWAYS })
    },
    /** The units whose turn `slots` gives now start: their actors are loaded from now on. */
    start() {
      for (const [level, cells] of levels) {
        if (started.has(level) || !slots.loads(count + level)) continue
        started.add(level)
        cells.forEach(weigh)
      }
    },
    /** Every unit let go. */
    clear: () => started.clear(),
  }
}

export type Tops = ReturnType<typeof createTops>
