/**
 * THE HLOD CELLS WHOSE VISIBILITY MOVED, per instance of the world DAG, kept for the partition
 * that follows them (`../../hlod/hlodCells.ts`): a cell shown or hidden moves its children's loads.
 * Listed as they switch (`worldFollow.ts`); past more moves than an instance has cells, the list
 * gives way to every cell.
 */

/** The moves of `instances` instances of `cells` cells each: every cell at the first ask. */
export function createVisibilityMoves(instances: number, cells: number) {
  /** Per instance, the cells whose visibility moved since its follower last asked; whether all of
   *  them did — at first, or once more moved than it has cells. */
  const moved: number[][] = Array.from({ length: instances }, () => []),
    all = new Uint8Array(instances).fill(1)
  return {
    /** Cell `cell` of instance `instance` switched. */
    note(instance: number, cell: number) {
      if (all[instance] || moved[instance].push(cell) <= cells) return
      all[instance] = 1
      moved[instance].length = 0
    },
    /** Each cell of instance `instance` whose visibility moved since the last call for it, told to
     *  `visit` — at the first call, or after more moves than cells, every cell. */
    moved(instance: number, visit: (cell: number) => void) {
      if (instance >= instances) return
      if (all[instance]) {
        for (let cell = 0; cell < cells; cell++) visit(cell)
        all[instance] = 0
      } else for (const cell of moved[instance]) visit(cell)
      moved[instance].length = 0
    },
  }
}
