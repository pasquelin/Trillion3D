/**
 * THE WORLD BUNDLES A PARTITION'S CELLS HOLD (#1237). A placed cell — or one held far by its
 * super-roots (`farCells.ts`) — holds the world bundles past the pinned top its objects' roots
 * depend on (`world`, `../scene/worldRoots.ts`), counted once per cell, until it is released. A
 * hold that failed holds nothing and is asked again at the next frame while its cell is placed.
 */
import type { WorldRootsHold } from '../scene/worldRoots.ts'

/** What a placed cell holds, counted per cell. */
type Holder = Pick<WorldRootsHold, 'hold' | 'release'>

const holdings = new WeakMap<object, CellHolds>()
/** `cells`, with their `holds` kept beside them: a model's public record carries the cells. */
export function withHolds<T extends object>(holds: CellHolds, cells: T): T {
  holdings.set(cells, holds)
  return cells
}
/** What the cells `withHolds` returned hold. */
export const cellHolds = (cells: object) => holdings.get(cells)!

/** The holds of the cells placed on `world`, each kept until its cell is released; none
 *  without a world. */
export function createCellHolds(world?: Holder) {
  /** The hold of each cell held, and the cells whose hold failed while placed. A cell that leaves
   *  while its hold reads releases once it lands: a hold that fails counts nothing, and releasing
   *  it too would drop a bundle another cell holds. */
  type Hold = { landed: boolean; left: boolean }
  const holding = new Map<number, Hold>(),
    failed = new Set<number>()
  let reads: Promise<void>[] = []
  const hold = (cell: number) => {
    if (!world || holding.has(cell)) return
    const own: Hold = { landed: false, left: false }
    holding.set(cell, own)
    const read = world.hold(cell).then(
      () => {
        own.landed = true
        if (own.left) world.release(cell)
      },
      () => {
        // Held again at the next frame, unless the cell left meanwhile.
        if (holding.get(cell) !== own) return
        holding.delete(cell)
        failed.add(cell)
      },
    )
    reads.push(read)
  }
  return {
    /** `cell` was placed: its bundles are held, and read if they are not. */
    hold,
    /** `cell` left: its bundles are released. */
    release(cell: number) {
      failed.delete(cell)
      const own = holding.get(cell)
      if (!own) return
      holding.delete(cell)
      if (own.landed) world!.release(cell)
      else own.left = true
    },
    /** The reads asked since the last call, the holds that failed asked again first. */
    reads() {
      for (const cell of failed) hold(cell)
      failed.clear()
      const asked = reads
      reads = []
      return asked
    },
    /** How many cells hold their bundles now. */
    held: () => holding.size,
  }
}

export type CellHolds = ReturnType<typeof createCellHolds>
