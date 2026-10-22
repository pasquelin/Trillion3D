/**
 * THE HLOD CELLS THE WISHED ONES PULL IN, on the HLOD grids whose wished cells pull in the coarser
 * cells overlapping them (`../partition/coarser.ts`): each frame (`update`), every cell of the
 * chain on such a grid — an HLOD 0 cell or one above — that the view's shape for its grid's range
 * meets (`StreamingSource.meets`) pulls in the cells of the chain at the coordinates it pulls,
 * wished then though the shape misses them (`pulled`): the plan's HLOD 0 cells
 * (`../partition/plan.ts`), and the cells above (`hlodCells.ts`). The main grids' cells pull theirs
 * in the plan, which alone knows them.
 *
 * Cost: O(C) at creation, C the chain's cells on such grids, then O(C + c) per move of the view
 * (`StreamingSource.revision`), c the coordinates pulled in, nothing while it stands; nothing for a
 * chain on no such grid.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import { NO_CELLS, type CoarserPull } from '../partition/coarser.ts'
import type { StreamingSource } from '../partition/source.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import { appendTo } from '../../../../math/src/sequence/counts.ts'

/** The cells of `chain` that the wished ones pull in on `grids`, as their `pulls` say, from the view
 *  `source`. */
export function createHlodPulls(
  chain: NonNullable<WorldRootsHold['table']>['chain'] | undefined,
  grids: readonly PartitionGrid[],
  pulls: readonly (CoarserPull | null)[],
  source: StreamingSource,
) {
  const count = chain?.parent.length ?? 0
  /** Per grid that pulls, its cells and those at each key. */
  const on = new Map<number, { cells: number[]; at: Map<number, number[]> }>()
  const keys = new Float64Array(count)
  for (let cell = 0; cell < count; cell++) {
    const grid = chain!.grid[cell],
      pull = pulls[grid]
    if (grids[grid].main || !pull) continue
    let cells = on.get(grid)
    if (!cells) on.set(grid, (cells = { cells: [], at: new Map() }))
    const key = (keys[cell] = pull.key(chain!.rung[cell], chain!.bounds, BOX_VALUES * cell))
    cells.cells.push(cell)
    appendTo(cells.at, key, cell)
  }
  /** Per cell: the shape meets it, and it is pulled in, the shape missing it. */
  const met = new Uint8Array(count),
    pulled = new Uint8Array(count)
  const seen = new Set<number>()
  /** The revision of the view the cells were last pulled from: a view that stands (`revision`) pulls
   *  what it pulled. */
  let seenRevision = -1
  return {
    /** The cells pulled in from the view as `source` stands now. */
    update() {
      if (!on.size || source.revision === seenRevision) return
      seenRevision = source.revision
      pulled.fill(0)
      for (const [grid, { cells, at }] of on) {
        const shape = grids[grid]
        for (const cell of cells)
          met[cell] = Number(source.meets(chain!.bounds, BOX_VALUES * cell, shape))
        seen.clear()
        for (const cell of cells) {
          if (!met[cell]) continue
          pulls[grid]!.pull(keys[cell], seen, (key) => {
            for (const there of at.get(key) ?? NO_CELLS) if (!met[there]) pulled[there] = 1
          })
        }
      }
    },
    /** Whether `cell` is pulled in, the shape missing it. */
    pulled: (cell: number) => pulled[cell] === 1,
    /** The cells of grid `grid` that may be pulled in. */
    on: (grid: number) => on.get(grid)?.cells ?? NO_CELLS,
  }
}

export type HlodPulls = ReturnType<typeof createHlodPulls>
