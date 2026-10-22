/**
 * THE COARSER CELLS A WISHED CELL PULLS IN, on a square grid whose job asks it (`pullCoarser`,
 * `TablePartition.hlod.coarser`, `compiler/tables/partition/square.rs`). Each level below the
 * grid's top holds one cell more per side than the finest level's halved, all centred on the
 * grid's origin, so a cell's edges pass between those of the levels above it. A wished cell then
 * pulls in every cell of each level above its own, below the top, that its square overlaps, and
 * each of those in turn the cells above it its square overlaps — by their coordinates, whether a
 * cell lies there or not —; a cell of the level just below the top pulls in none, and the top's
 * one cell is the always loaded one.
 *
 * Cost: O(c) per wished cell, c the coordinates it pulls in; each coordinate is told once per
 * `seen`.
 */
import { appendTo } from '../../../../math/src/sequence/counts.ts'
import type {
  CoarserGrid,
  PartitionGrid,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts'

/** No cell. */
export const NO_CELLS: readonly number[] = []

/** Cells per side a key holds exactly, `2²⁴`; levels it holds, `2⁵`: their product fits a
 *  double's 53 bits. */
const SPAN = 0x1000000

/** A cell's key on its grid from its level and its coordinates on glTF's `x` and `z`. */
export const coarserKey = (level: number, x: number, z: number) => (level * SPAN + x) * SPAN + z

/** The pull of square grid `grid`, of finest cell side `cell`. */
function createCoarserPull(grid: CoarserGrid, cell: number) {
  const top = Math.log2(grid.cells)
  const side = (level: number) => cell * 2 ** level
  /** The cells per side of `level`: the finest level's halved, one more below the top. */
  const count = (level: number) => grid.cells / 2 ** level + (level < top ? 1 : 0)
  /** The cell of `level` under `at` along an axis whose origin is `origin`, unbounded. */
  const under = (at: number, origin: number, level: number) =>
    Math.floor((at - origin) / side(level) + count(level) * 0.5)
  /** The low corner of the square of `level` along an axis whose origin is `origin`. */
  const low = (origin: number, level: number) => origin - count(level) * side(level) * 0.5
  const queue: number[] = []
  return {
    /** How far past a wished cell the cells it pulls in may lie: the diagonal of a cell of the
     *  level below the top, more than every coarser one's below it together. */
    reach: top >= 1 ? side(top - 1) * Math.SQRT2 : 0,
    /** The key of the cell of `level` whose square on the ground `bounds` at `at` are. */
    key(level: number, bounds: ArrayLike<number>, at: number) {
      const s = side(level)
      const x = Math.round((bounds[at] - low(grid.x, level)) / s),
        z = Math.round((bounds[at + 2] - low(grid.z, level)) / s)
      return coarserKey(level, x, z)
    },
    /** Each cell the wished cell of `key` pulls in, told to `visit` by its key unless `seen`
     *  holds it, and added to it. */
    pull(key: number, seen: Set<number>, visit: (key: number) => void) {
      queue.length = 0
      queue.push(key)
      for (let at = queue.pop(); at !== undefined; at = queue.pop()) {
        const z = at % SPAN,
          x = Math.floor(at / SPAN) % SPAN,
          level = Math.floor(at / (SPAN * SPAN))
        const s = side(level),
          minX = low(grid.x, level) + x * s,
          minZ = low(grid.z, level) + z * s
        for (let up = level + 1; up < top; up++) {
          const n = count(up)
          const x0 = under(minX, grid.x, up),
            x1 = under(minX + s, grid.x, up),
            z0 = under(minZ, grid.z, up),
            z1 = under(minZ + s, grid.z, up)
          if (x0 >= n || z0 >= n || x1 < 0 || z1 < 0) continue
          for (let cx = Math.max(x0, 0); cx <= Math.min(x1, n - 1); cx++)
            for (let cz = Math.max(z0, 0); cz <= Math.min(z1, n - 1); cz++) {
              const pulled = coarserKey(up, cx, cz)
              if (seen.has(pulled)) continue
              seen.add(pulled)
              visit(pulled)
              queue.push(pulled)
            }
        }
      }
    },
  }
}

export type CoarserPull = ReturnType<typeof createCoarserPull>

/** Per grid of `hlod`, its pull (`createCoarserPull`), `null` for a grid whose wished cells pull in
 *  none. */
export const createCoarserPulls = ({
  grids,
  coarser,
}: {
  grids: readonly PartitionGrid[]
  coarser: readonly (CoarserGrid | null)[]
}): readonly (CoarserPull | null)[] =>
  coarser.map((grid, at) => grid && createCoarserPull(grid, grids[at].cell))

/** What a main grid that pulls keeps of a frame: the cells met at each key, the keys of those
 *  wished, and the one function that tells the cells a key pulls in. */
type MainPull = {
  pull: CoarserPull
  at: Map<number, number[]>
  seeds: number[]
  tell: (key: number) => void
}

/**
 * The cells of the main grids whose wished cells pull in the coarser ones (`pulls`), a frame at a
 * time: `restart` it, `meet` each cell the walk finds on such a grid, then `pull` tells which of
 * them the wished ones pull in. Made once, a frame allocates nothing but the lists of its keys.
 */
export function createMainPulls(pulls: readonly (CoarserPull | null)[]) {
  const seen = new Set<number>()
  /** The frame's `visit`, which every grid's `tell` reads. */
  let visit: (main: number, cell: number) => void = () => {}
  const entries = pulls.map((pull, main): MainPull | null => {
    if (!pull) return null
    const at = new Map<number, number[]>()
    const tell = (key: number) => {
      const cells = at.get(key) ?? NO_CELLS
      for (let i = 0; i < cells.length; i++) visit(main, cells[i])
    }
    return { pull, at, seeds: [], tell }
  })
  const active = entries.filter((entry): entry is MainPull => entry !== null)
  return {
    restart() {
      for (let i = 0; i < active.length; i++) {
        active[i].at.clear()
        active[i].seeds.length = 0
      }
    },
    /** Main grid `main`, which pulls, meets `cell` at `key`, `wished` or not. */
    meet(main: number, key: number, cell: number, wished: boolean) {
      const entry = entries[main]!
      appendTo(entry.at, key, cell)
      if (wished) entry.seeds.push(key)
    },
    /** Tells `told` each cell a wished one pulls in, with its main grid, once. */
    pull(told: (main: number, cell: number) => void) {
      visit = told
      for (let i = 0; i < active.length; i++) {
        const { pull, seeds, tell } = active[i]
        seen.clear()
        for (let seed = 0; seed < seeds.length; seed++) pull.pull(seeds[seed], seen, tell)
      }
    },
  }
}
