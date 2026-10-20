/**
 * THE CHAIN OF HLOD CELLS A PARTITION FOLLOWS: which cells are wished, told to the cut, and the
 * roots each cell holds while its actor is loaded.
 *
 * Each HLOD layer's grid streams its cells within its loading range: an HLOD cell of layer `l` is wished while its streaming bounds lie
 * within `ranges[l + 1]` of the eye, in 2D as its grid tests it — an HLOD 0 cell as the plan finds
 * it (`plan.ts`). A cell's actor of the next layer is content of the cell it lies in, its parent in
 * the chain: loaded while that parent is loaded — wished, or still visible until it is made
 * invisible, a cell unloaded only once hidden —, always for a top cell, whose layer is
 * always loaded (`compiler_tables/partition/hlod.rs`). A loaded actor's roots are held, visible or
 * not: a loaded HLOD actor stays hidden while its source cell is visible, ready for the switch.
 * The holds are read in streaming order:
 * the highest layer first — the top one, always loaded —, then by the square of the distance from
 * the eye to the cell's box over its grid's range times how far the cell lies behind the view
 * — the near cells in front first —; each hold's read priority is its rank in that order, lifted as the order moves.
 * Each frame the cut is told what each cell is (`WorldCells.show`) and switches its visibility
 * (`../gpu/dag/worldFollow.ts`); nothing is done again while nothing moved.
 */
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import type { WorldCells } from '../gpu/core/selection.ts'
import type { createCellHolds } from './cellHolds.ts'
import type { LeafWish } from './plan.ts'
import { CELL_TOLD } from '../gpu/dag/worldFollow.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import { BOX_VALUES } from '../../../math/src/geometry/box.ts'
import { boxGroundDistance } from '../../../math/src/geometry/boxDistance.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import { keepNumbers } from '../../../math/src/vector/vector.ts'

/** The chain of HLOD cells of a partition, their roots held in `holds` on `world`'s table, `ranges`
 *  the grids' loading ranges (`TablePartition.hlod.ranges`). */
export function createHlodCells(
  world: Partial<Pick<WorldRootsHold, 'table'>> | undefined,
  holds: ReturnType<typeof createCellHolds>,
  ranges: readonly number[],
) {
  const chain = world?.table?.chain
  const count = chain?.parent.length ?? 0
  /** Per cell: wished, every cell file of an HLOD 0 cell placed, and its streaming order. */
  const wished = new Uint8Array(count),
    placed = new Uint8Array(count),
    sorting = new Float64Array(count),
    /** The word each cell was last told (`CELL_TOLD`). */
    toldWords = new Uint8Array(count)
  /** The cells whose actors are loaded, in streaming order, and whether each is listed there. */
  const loadedCells: number[] = [],
    listed = new Uint8Array(count)
  /** Streaming order, ties by cell: one order whatever the list's order before, so the last
   *  frame's — nearly this one's as the camera moves — sorts in about one pass. */
  const streamingOrder = (a: number, b: number) =>
    chain!.level[b] - chain!.level[a] || sorting[a] - sorting[b] || a - b
  /** What the cells were last followed under: the eye and view axis, the cut and the instance of
   *  the world DAG, the cut's visibility and the holds. */
  const seenEye = new Float64Array(3).fill(NaN),
    seenAxis = new Float64Array(3).fill(NaN)
  let toldTo: WorldCells | undefined,
    instance = 0,
    seenVisible = -1,
    seenHolds = -1
  const visible = (cell: number) => !!toldTo?.visible(instance, cell)
  /** Whether the cut's last image had `cell` stand for an actor it cannot draw. */
  const stands = (cell: number) => !!toldTo?.stands(instance, cell)
  /** Whether `cell`'s actor is loaded: a top cell's always, else while its parent is wished — told
   *  so, or standing for an actor it cannot draw — or still visible. */
  const loaded = (cell: number) => {
    const up = chain!.parent[cell]
    return up < 0 || wished[up] === 1 || visible(up) || stands(up)
  }
  /** Each upper cell's wish and each cell's streaming order from `eye` looking along `axis`;
   *  whether either moved. */
  const measure = (eye: ArrayLike<number>, axis: ArrayLike<number>) => {
    const eyeStill = keepNumbers(seenEye, eye)
    if (keepNumbers(seenAxis, axis) && eyeStill) return false
    const { bounds, level } = chain!
    const x = eye[0],
      y = eye[1],
      z = eye[2]
    for (let cell = 0; cell < count; cell++) {
      const at = BOX_VALUES * cell,
        range = ranges[level[cell] + 1]
      // In range in 2D, as its grid tests it.
      if (level[cell] > 0) {
        wished[cell] = Number(boxGroundDistance(bounds, at, x, z) <= range)
      }
      // Ordered in 3D from the nearest point of its box: inside, first; else the cosine of the
      // view axis to the cell-to-eye direction, a cell ahead first.
      const dx = x - clamp(x, bounds[at], bounds[at + 3]),
        dy = y - clamp(y, bounds[at + 1], bounds[at + 4]),
        dz = z - clamp(z, bounds[at + 2], bounds[at + 5])
      const squared = dx * dx + dy * dy + dz * dz
      const cos =
        squared > 0 ? (axis[0] * dx + axis[1] * dy + axis[2] * dz) / Math.sqrt(squared) : -1
      sorting[cell] = clamp(squared / (range * range), 0, 1) * (cos * 0.5 + 0.5)
    }
    return true
  }
  /** Each loaded actor's roots held in streaming order, every other let go, and each cell told
   *  what it is; whether a word told moved, which moves what is loaded. */
  const loadPass = () => {
    for (const cell of holds.cells()) if (!loaded(cell)) holds.release(cell)
    listed.fill(0)
    let kept = 0
    for (const cell of loadedCells)
      if (loaded(cell)) {
        listed[cell] = 1
        loadedCells[kept++] = cell
      }
    loadedCells.length = kept
    for (let cell = 0; cell < count; cell++)
      if (!listed[cell] && loaded(cell)) loadedCells.push(cell)
    loadedCells.sort(streamingOrder)
    // Strictly after the view's own pages, in the visible band, by rank.
    const ranked = loadedCells.length
    for (let rank = 0; rank < ranked; rank++)
      holds.hold(loadedCells[rank], PRIORITY_VISIBLE + (1 + rank / ranked) / 2)
    let toldMoved = false
    for (let cell = 0; cell < count; cell++) {
      let word = wished[cell] ? CELL_TOLD.wished : 0
      if (placed[cell]) word |= CELL_TOLD.placed
      if (holds.failed(cell)) word |= CELL_TOLD.failed
      if (toldWords[cell] !== word) {
        toldWords[cell] = word
        toldMoved = true
      }
      toldTo?.show(instance, cell, word)
    }
    return toldMoved
  }
  return {
    /** The frame from `eye` looking along `axis` (unit, in the cells' frame), with the HLOD 0 cells
     *  the plan met (`leaves`): each cell told to `cells`, as instance `at` of the world DAG; each
     *  loaded actor's roots held at its rank in streaming order, every other let go. */
    follow(
      leaves: ReadonlyMap<number, LeafWish>,
      eye: ArrayLike<number>,
      axis: ArrayLike<number>,
      cells: WorldCells | undefined,
      at: number,
    ) {
      if (!chain) return
      let moved = cells !== toldTo || at !== instance
      // Another cut or instance was told nothing yet: what it is told first counts as moved.
      if (moved) toldWords.fill(0)
      toldTo = cells
      instance = at
      moved = measure(eye, axis) || moved
      for (let cell = 0; cell < count; cell++) {
        if (chain.level[cell] !== 0) continue
        const leaf = leaves.get(cell),
          wish = Number(!!leaf?.wished),
          whole = Number(!!leaf?.placed)
        if (wished[cell] === wish && placed[cell] === whole) continue
        wished[cell] = wish
        placed[cell] = whole
        moved = true
      }
      const shownRevision = cells?.revision ?? 0
      if (!moved && shownRevision === seenVisible && holds.revision === seenHolds) return
      seenVisible = shownRevision
      // What a cell is told moves what is loaded — a cell whose actor failed stands for it, its
      // children loaded (`stands`) —, and the cut reads it as soon as it is told: the pass runs
      // again on what it told, never left for a camera move that may not come.
      for (let pass = 0; pass <= count; pass++) if (!loadPass()) break
      seenHolds = holds.revision
    },
    /** Whether HLOD cell `cell` was visible at the cut's last image. */
    visible,
    /** Whether HLOD cell `cell` stood, at the cut's last image, for an actor it cannot draw. */
    stands,
    /** Every cell let go: its roots, and what it was told. */
    close(cells: WorldCells | undefined, at: number) {
      for (const cell of holds.cells()) holds.release(cell)
      for (let cell = 0; cell < count; cell++) cells?.show(at, cell, 0)
      wished.fill(0)
      placed.fill(0)
      toldWords.fill(0)
      seenEye.fill(NaN)
      toldTo = undefined
    },
  }
}
