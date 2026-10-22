/**
 * THE ROWS OF EACH HLOD CELL'S INSTANCED ACTOR: the objects that stand as themselves in an actor
 * (`WorldRoots.rows`, `hlod/chain/builds/instanced.rs`) — every object of an instanced layer, those
 * marked so of any other — are no pages of the world DAG but their source meshes placed again:
 * each a row of its mesh at its world matrix, on the very rows the cells place
 * (`../partition/placements.ts`, `placeActor`), drawn by the mesh's own pages, nothing copied.
 *
 * An actor's rows stream with it: one bundle of the binary its cell holds with its actor's root
 * pages (`WorldRoots.rows`), read as its actor is loaded (`hold`, `hlodCells.ts`) and let go with
 * it — what is held is what is loaded, never the world's rows. Read, they are placed while the cut
 * follows the world (`turn`, `place`): each lies in its HLOD cell as that cell's actor's
 * (`RowCell.actor`), drawn while the cell draws its actor and counted in its readiness
 * (`../dag/worlds/worldLinks.ts`, `ACTOR_ROW`); the cell's parent holds a loading slot no longer
 * than the reads last (`hlodCells.ts`), rows placed or not. The rows of the actors read are counted
 * per mesh (`loaded`), what the rows are sized by beside what the cells' view asks
 * (`../partition/sizing.ts`): a mesh short of rows keeps an actor's waiting, the rows grown for it
 * (`shortage`), and they are placed at a next frame.
 *
 * Cost: per actor held, read or let go, O(its rows); per frame, O(actors read and not placed).
 */
import type { WorldRoots } from '../../../../sdk-core/src/manifest/worldRoots.ts'
import { actorRows } from '../../../../sdk-core/src/manifest/worldRootsTable.ts'
import { countBy } from '../../../../math/src/sequence/counts.ts'
import type { CellRows } from '../partition/cellDecode.ts'
import type { WorldRootsHold } from './worldRoots.ts'

/** What places an actor's rows and parks them (`createCellPlacements`). */
type ActorPlacer = {
  placeActor(cell: number, level: number, decoded: CellRows): boolean
  leaveActor(cell: number): void
}

/** An actor's rows as a decoded cell's (`actorRows`): under the scene root, each its mesh at its
 *  world matrix, playing its track. */
function cellRowsOf(bytes: Uint8Array, nodes: number): CellRows {
  const { mesh, track, matrix } = actorRows(bytes, nodes)
  const ranks = new Int32Array(2 * nodes)
  for (let node = 0; node < nodes; node++) {
    ranks[2 * node] = -1
    ranks[2 * node + 1] = mesh[node]
  }
  return {
    nodes,
    ranks,
    locals: matrix,
    tracks: track,
    sources: new Uint8Array(nodes),
    drawDistances: new Float32Array(2 * nodes),
  }
}

/** The rows of `world`'s actors, read through it and placed and parked by `placer`. */
export function createActorRows(
  world: Partial<Pick<WorldRootsHold, 'table' | 'bytesOf'>> | undefined,
  placer: ActorPlacer,
) {
  const table: Pick<WorldRoots, 'rows' | 'chain'> | undefined = world?.table,
    rows = table?.rows
  /** Per cell whose actor is held, what lets its read go; its rows once read; the cells read and
   *  not placed, those a mesh short of rows keeps waiting, and those placed. */
  const holding = new Map<number, AbortController>(),
    landed = new Map<number, CellRows>(),
    unplaced = new Set<number>(),
    short = new Set<number>(),
    seated = new Set<number>()
  /** The rows of the actors read, per mesh rank; how many actors found a mesh short of rows, and
   *  whether the cut follows the world. */
  const loaded = new Map<number, number>()
  let shortage = 0,
    on = false
  /** `decoded`'s rows counted `by` more in `loaded`. */
  const count = (decoded: CellRows, by: number) => {
    const { nodes, ranks } = decoded
    for (let node = 0; node < nodes; node++) countBy(loaded, ranks[2 * node + 1], by)
  }
  /** Places cell `cell`'s rows read, once, while the cut follows the world; a mesh short of rows
   *  keeps them waiting. `moved` told of a cell placed. */
  const place = (cell: number, moved?: (cell: number) => void) => {
    const decoded = landed.get(cell)
    if (!on || !decoded || seated.has(cell)) return
    if (!placer.placeActor(cell, table!.chain.actorLevel[cell], decoded)) {
      if (!short.has(cell)) shortage++
      return void short.add(cell)
    }
    seated.add(cell)
    unplaced.delete(cell)
    short.delete(cell)
    moved?.(cell)
  }
  /** Parks cell `cell`'s rows, if placed; `moved` told of it. */
  const park = (cell: number, moved?: (cell: number) => void) => {
    if (!seated.delete(cell)) return
    placer.leaveActor(cell)
    if (landed.has(cell)) unplaced.add(cell)
    moved?.(cell)
  }
  return {
    /** The rows of the actors read, per mesh rank. */
    loaded: loaded as ReadonlyMap<number, number>,
    /** Advanced whenever an actor's rows find a mesh short of rows, once till they are placed. */
    get shortage() {
      return shortage
    },
    /** Cell `cell`'s actor is loaded: its rows are read at `priority`, with its hold's read. */
    hold(cell: number, priority?: number) {
      if (!rows?.count[cell] || holding.has(cell) || !world?.bytesOf) return
      const stop = new AbortController()
      holding.set(cell, stop)
      world.bytesOf(rows.bundle[cell], stop.signal, priority).then(
        (bytes) => {
          if (stop.signal.aborted) return
          const decoded = cellRowsOf(bytes, rows.count[cell])
          landed.set(cell, decoded)
          unplaced.add(cell)
          count(decoded, 1)
        },
        // A read refused is its hold's: the hold fails with it (`../partition/cellHolds.ts`).
        () => undefined,
      )
    },
    /** Cell `cell`'s actor let go: its read let go, its rows parked and forgotten. */
    release(cell: number) {
      holding.get(cell)?.abort()
      holding.delete(cell)
      park(cell)
      unplaced.delete(cell)
      short.delete(cell)
      const decoded = landed.get(cell)
      if (decoded) count(decoded, -1)
      landed.delete(cell)
    },
    /** The cut follows the world (`WorldCells`), or no longer: without it no row would be
     *  switched, so none is placed. Each cell whose rows were placed or parked told to `moved`. */
    turn(follows: boolean, moved: (cell: number) => void) {
      if (follows === on) return
      on = follows
      if (on) for (const cell of unplaced) place(cell, moved)
      else for (const cell of seated) park(cell, moved)
    },
    /** The rows read and not placed yet placed where their meshes have rows, each cell placed
     *  told to `moved`. */
    place(moved: (cell: number) => void) {
      for (const cell of unplaced) place(cell, moved)
    },
    /** Whether cell `cell`'s actor's rows are placed. */
    seated: (cell: number) => seated.has(cell),
  }
}

export type ActorRows = ReturnType<typeof createActorRows>
