/**
 * THE CELLS A PARTITION HOLDS BY THEIR SUPER-ROOTS ALONE (#1332).
 *
 * As World Partition's streaming policy does each update, a frame's plan (`plan.ts`) chooses each
 * cell's state from the source's real data: placed, its objects read and drawn, or held far, drawn
 * by its super-roots — the world bundles its objects' roots need held (`../scene/worldRoots.ts`), its
 * object pages unread. That choice is the cut's, on the cut's own lens (`superRoots.ts`), and only
 * once the cut packs the world DAG (`GpuSelection.packsWorld`, #1333): until then no cell is ever
 * held far, since nothing would draw its super-roots, and the plan is the one it always was.
 *
 * The super-roots' bound per cell comes from the world stream (`WorldRootsHold.stream`), opened
 * here on the first frame whose cut packs the world DAG: a load never reads the DAG file (#1232).
 * A far cell is held in the partition's one registry (`createCellHolds`), its state far: demoted
 * or promoted, it keeps its one hold.
 */
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import type { createCellHolds } from './cellHolds.ts'
import { planCells, type SuperRootPlan } from './plan.ts'
import { cellSuperRootError, type SuperRootLens } from './superRoots.ts'

/** The world bundles a cell holds, the stream its super-roots' bound is read from, and whether
 *  the cut's cache has room for the roots a far cell adds. */
type World = Pick<WorldRootsHold, 'hold' | 'release'> &
  Partial<Pick<WorldRootsHold, 'stream' | 'cover'>>

/** The cells a partition places, by rank. */
type Placed = ReadonlyMap<number, unknown>

/** The far cells of a partition whose placed cells are `placed`, held in `holds`, its one
 *  registry, on `world`. */
export function createFarCells(
  world: World | undefined,
  placed: Placed,
  holds: ReturnType<typeof createCellHolds>,
) {
  /** The cells this frame's plan reaches, held or not: the cover forgets every other. */
  const reached = new Set<number>()
  /** Each cell's super-root bound, once the world stream opened; whether it is opening. */
  let bounds: Float64Array | undefined,
    opening = false
  /** Placed or held far: every cell the plan holds. */
  const held = {
    has: (cell: number) => placed.has(cell) || holds.far(cell),
    *keys() {
      yield* placed.keys()
      yield* holds.farCells()
    },
  }
  /** What the cover keeps: the cells the plan reaches or holds — made once. */
  const kept = { has: (cell: number) => reached.has(cell) || held.has(cell) }
  /** `cell`'s far hold is let go, past the keep sphere or once no cut draws its super-roots;
   *  whether it had one. */
  const release = (cell: number) => holds.far(cell) && (holds.release(cell), true)
  /** The plan's reading of the super-roots from `eye` through the cut's `lens`, or none: no cut
   *  packs the world DAG, or its bound is not read yet (asked here, once; a refusal asks again). */
  const superRoots = (eye: ArrayLike<number>, lens?: SuperRootLens): SuperRootPlan | undefined => {
    if (!lens || !world?.stream) return undefined
    if (!bounds && !opening) {
      opening = true
      world.stream().then(
        (stream) => void (bounds = stream.superRoots),
        () => void (opening = false),
      )
    }
    const read = bounds
    if (!read) return undefined
    const projected = (cell: number) => cellSuperRootError(read, cell, eye, lens)
    return { placed, target: lens.pixelError, projected }
  }
  return {
    /**
     * The frame's plan (`planCells`) from `eye` (world space), in the cells' frame `local`, through
     * `lens` while the cut packs the world DAG: the cells found far are held by their super-roots,
     * and those `demoted` give their objects back (`park`) and are held far, their hold kept.
     * Without `lens`, the plan of placed cells alone.
     */
    plan(
      index: Parameters<typeof planCells>[0],
      local: { eye: ArrayLike<number>; reach: number },
      eye: ArrayLike<number>,
      lens: SuperRootLens | undefined,
      park: (cell: number) => void,
    ) {
      const reading = superRoots(eye, lens)
      // A cut that no longer packs the world DAG draws no super-root: no cell stays held far. A
      // cell placed since holds as placed already (`createCellHolds`).
      if (!reading) for (const cell of holds.farCells()) release(cell)
      const plan = planCells(index, local.eye, local.reach, reading ? held : placed, reading)
      // What the cover counted of a cell past the plan's reach, and held by no plan, is forgotten.
      reached.clear()
      for (const cell of plan.far) reached.add(cell)
      world?.cover?.keep(kept)
      // A cell whose roots the cache has no room for is not held far: the plan holds no more.
      for (const cell of plan.far) {
        if (world?.cover && !world.cover.admits(cell)) continue
        holds.hold(cell, plan.priority.get(cell)!, true)
      }
      // A demoted cell keeps its one hold, its state far: the world bundles it needs stay held,
      // never read again.
      for (const cell of plan.demoted) {
        park(cell)
        holds.hold(cell, plan.priority.get(cell)!, true)
      }
      return plan
    },
    release,
  }
}
