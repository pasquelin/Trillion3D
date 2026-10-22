/**
 * THE ACTORS ALWAYS LOADED OF AN HLOD CHAIN: those no cell holds — a chain's top, or an actor
 * built by a layer not spatially loaded (`src/hlod/cells.rs`). The actors always loaded of one
 * level lie together, so they make one unit of it, as the actors a cell holds do
 * (`hlodCells.ts`): it waits to load in the partition's one load order (`LoadSlots`), after every
 * cell a view reaches — none reaches it, so nothing else ranks it (`LoadingCell.always`) —, starts
 * while room is left and takes none, and is loading until the reads of every actor of it are
 * done, rows waiting for room in the pool or not; its actors are loaded from the moment it starts,
 * whatever the view. Its key lies past the chain's cells' (`unitKeys.ts`).
 *
 * Cost: O(C) once at creation for C cells of the chain, O(1) a landing told, O(L) a frame for L
 * levels.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import type { LoadingCell } from '../partition/loadOrder.ts'
import type { LoadSlots } from '../partition/loadSlots.ts'
import { topUnit } from '../partition/unitKeys.ts'
import { CHAIN_ACTOR } from '../../../../sdk-core/src/manifest/worldRoots.ts'

/** What ranks a unit of the actors always loaded in the load order: nothing but `always`. */
const ALWAYS = { extent: 0, level: 0, priority: 0, distance: 0, raw: 0, always: true }

/** One level's unit: its cells, how many of them are not landed yet, and the record that ranks it
 *  while it waits. */
type Level = { cells: number[]; unlanded: number; rank: LoadingCell }

/** The units of the actors always loaded of `chain`, each loading as `slots` says: `weigh` told that
 *  an actor's load may have moved, each actor's landing told to `landing`. */
export function createTops(
  chain: NonNullable<WorldRootsHold['table']>['chain'] | undefined,
  slots: Pick<LoadSlots, 'loads'>,
  weigh: (cell: number) => void,
) {
  const count = chain?.parent.length ?? 0
  /** The cells whose actors are always loaded, by the level of their actors, and the levels whose
   *  turn has come. */
  const levels = new Map<number, Level>(),
    started = new Set<number>()
  for (let cell = 0; cell < count; cell++) {
    if (chain!.parent[cell] >= 0 || !(chain!.actor[cell] & CHAIN_ACTOR.built)) continue
    const level = chain!.actorLevel[cell]
    let top = levels.get(level)
    if (!top) {
      const rank = { key: topUnit(count, level), ...ALWAYS }
      levels.set(level, (top = { cells: [], unlanded: 0, rank }))
    }
    top.cells.push(cell)
    top.unlanded++
  }
  return {
    /** The key of the unit `cell`'s actor, always loaded, belongs to. */
    key: (cell: number) => topUnit(count, chain!.actorLevel[cell]),
    /** Whether `cell`'s actor, always loaded, is loaded: its unit's turn has come. */
    opened: (cell: number) => started.has(chain!.actorLevel[cell]),
    /** The actor of `cell`, always loaded, is landed now, or no longer. */
    landing(cell: number, landed: boolean) {
      levels.get(chain!.actorLevel[cell])!.unlanded += landed ? -1 : 1
    },
    /** The units not whole, onto `out`: those waiting for their turn and those loading. */
    waiting(out: LoadingCell[]) {
      for (const [level, top] of levels)
        if (!started.has(level) || top.unlanded > 0) out.push(top.rank)
    },
    /** The units whose turn `slots` gives now start: their actors are loaded from now on. */
    start() {
      for (const [level, { cells, rank }] of levels) {
        if (started.has(level) || !slots.loads(rank.key)) continue
        started.add(level)
        cells.forEach(weigh)
      }
    },
    /** Every unit let go, none of its actors landed. */
    clear() {
      started.clear()
      for (const top of levels.values()) top.unlanded = top.cells.length
    },
  }
}

export type Tops = ReturnType<typeof createTops>
