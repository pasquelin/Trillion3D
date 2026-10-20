/**
 * THE CHAIN OF HLOD CELLS A PARTITION FOLLOWS: which cells are wished, told to the cut, and the
 * roots each cell holds while its actor is loaded.
 *
 * Each HLOD layer's grid streams its cells within its loading range: an HLOD cell of layer `l` is wished while its streaming bounds lie
 * within `ranges[l + 1]` of the eye, in 2D as its grid tests it — an HLOD 0 cell as the plan finds
 * it (`../partition/plan.ts`). A cell's actor of the next layer is content of the cell it lies in, its parent in
 * the chain: loaded while that parent is loaded — wished, or still visible until it is made
 * invisible, a cell unloaded only once hidden —, always for a top cell, whose layer is
 * always loaded (`compiler_tables/partition/hlod.rs`). A cell with no actor holds nothing. A loaded actor's roots are held, visible or
 * not: a loaded HLOD actor stays hidden while its source cell is visible, ready for the switch.
 * The holds are read in streaming order:
 * the highest layer first — the top one, always loaded —, then by the square of the distance from
 * the eye to the cell's box over its grid's range times how far the cell lies behind the view
 * — the near cells in front first —; each hold's read priority is that order's key itself, on a
 * 1/64 grid, so no list is sorted, and a hold still reading is lifted as the order moves.
 *
 * The tops hold within the tops' budget (`worldBundles.ts`), nearest first; a top past it
 * is refused (`CELL_TOLD.refused`): it stands for nothing, its content following its range as a
 * cell with no actor's — never every child of it loaded at any distance —, and is tried again as
 * room frees or the view moves.
 *
 * A frame does only what moved: each level's cells are found around the eye in a grid of their
 * own, one bucket a loading range wide (`createLevelGrids`), the cells entering or leaving its range
 * alone told again; a cell whose word or whose parent's visibility moved has its children's loads
 * weighed again, and nothing else. Each frame the cut is told what each cell that moved is
 * (`WorldCells.show`) and switches its visibility (`../dag/worlds/worldFollow.ts`).
 *
 * Cost, for C cells of the chain, L levels and n cells within a level's range: O(C) once at
 * creation, then per eye move O(L · n), per moved cell O(its children), per view turn O(holds
 * still reading + tops refused); nothing per frame while nothing moved.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import type { WorldCells } from '../../gpu/core/selection.ts'
import type { createCellHolds } from '../partition/cellHolds.ts'
import type { LeafWish } from '../partition/plan.ts'
import { CELL_TOLD } from '../dag/worlds/worldFollow.ts'
import { CHAIN_ACTOR, chainChildren } from '../../../../sdk-core/src/manifest/worldRoots.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import { boxGroundDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { keepNumbers } from '../../../../math/src/vector/vector.ts'

type Chain = NonNullable<WorldRootsHold['table']>['chain']

/** A bucket holding no cell. */
const NO_CELLS: readonly number[] = []
/** Read priorities are kept on a 1/64 grid: a hold is lifted only once its order moved by that. */
const PRIORITY_STEPS = 64

/** A bucket's key from its two coordinates: exact while each lies within ±2²⁵. */
const bucketKey = (ix: number, iz: number) => (ix + 0x2000000) * 0x4000000 + (iz + 0x2000000)

/**
 * Per HLOD level above 0, the cells of `chain` filed on the ground in buckets as wide as their
 * grid's loading range (`ranges[level + 1]`), each in every bucket its streaming bounds meet: the
 * cells within that range of an eye lie in the 3 × 3 buckets around it at most (`near`).
 */
function createLevelGrids(chain: Chain, ranges: readonly number[]) {
  const { bounds, level } = chain,
    count = level.length
  const grids = new Map<number, { side: number; buckets: Map<number, number[]> }>()
  for (let cell = 0; cell < count; cell++) {
    if (level[cell] === 0) continue
    let grid = grids.get(level[cell])
    if (!grid)
      grids.set(level[cell], (grid = { side: ranges[level[cell] + 1], buckets: new Map() }))
    const { side, buckets } = grid,
      at = BOX_VALUES * cell
    for (let ix = Math.floor(bounds[at] / side); ix <= Math.floor(bounds[at + 3] / side); ix++)
      for (
        let iz = Math.floor(bounds[at + 2] / side);
        iz <= Math.floor(bounds[at + 5] / side);
        iz++
      ) {
        const key = bucketKey(ix, iz)
        const list = buckets.get(key)
        if (list) list.push(cell)
        else buckets.set(key, [cell])
      }
  }
  /** The frame each cell was last met at by `near`: a cell filed in several buckets once. */
  const metAt = new Uint32Array(count)
  let frame = 0
  return {
    /** The levels above 0 that hold cells. */
    levels: () => grids.keys(),
    /** Each cell of `at` within its range of `(x, z)` on the ground, as its grid tests it, told to
     *  `visit` once. */
    near(at: number, x: number, z: number, visit: (cell: number) => void) {
      const grid = grids.get(at)
      if (!grid) return
      frame++
      const { side, buckets } = grid
      for (let ix = Math.floor((x - side) / side); ix <= Math.floor((x + side) / side); ix++)
        for (let iz = Math.floor((z - side) / side); iz <= Math.floor((z + side) / side); iz++) {
          for (const cell of buckets.get(bucketKey(ix, iz)) ?? NO_CELLS) {
            if (metAt[cell] === frame) continue
            metAt[cell] = frame
            if (boxGroundDistance(bounds, BOX_VALUES * cell, x, z) <= side) visit(cell)
          }
        }
    },
  }
}

/** The chain of HLOD cells of a partition, their roots held in `holds` on `world`'s table, `ranges`
 *  the grids' loading ranges (`TablePartition.hlod.ranges`). */
export function createHlodCells(
  world: Partial<Pick<WorldRootsHold, 'table'>> | undefined,
  holds: ReturnType<typeof createCellHolds>,
  ranges: readonly number[],
) {
  const chain = world?.table?.chain
  const count = chain?.parent.length ?? 0
  /** Per cell: wished, every cell file of an HLOD 0 cell placed, its actor's roots held, and the
   *  word it was last told (`CELL_TOLD`). */
  const wished = new Uint8Array(count),
    placed = new Uint8Array(count),
    loadedNow = new Uint8Array(count),
    toldWords = new Uint8Array(count)
  /** Each cell's children: the cells whose actors lie in it. */
  const below = chain ? chainChildren(chain.parent) : []
  let topLevel = 0
  for (let cell = 0; cell < count; cell++) topLevel = Math.max(topLevel, chain!.level[cell])
  const grids = chain && createLevelGrids(chain, ranges)
  /** Per level above 0, the cells wished now and the list the next measure fills, swapped; the
   *  HLOD 0 cells wished or placed now. */
  const wishedOf = new Map<number, [number[], number[]]>(),
    leavesOn = new Set<number>()
  /** The top cells the tops' budget refused (`refused`), tried again as room frees or the view
   *  moves, nearest first; and those whose load waits for that order in a settle. */
  const refused = new Uint8Array(count),
    refusedTops = new Set<number>(),
    topsDue: number[] = []
  /** The cells whose actors are loaded. */
  const loadedCells = new Set<number>()
  /** The cells whose word may have moved, and those whose load may have. */
  const toldDue: number[] = [],
    loadDue: number[] = []
  /** What the cells were last followed under: the eye and view axis, the cut and the instance of
   *  the world DAG, and the holds. */
  const seenEye = new Float64Array(3).fill(NaN),
    seenAxis = new Float64Array(3).fill(NaN)
  let toldTo: WorldCells | undefined,
    instance = 0,
    seenHolds = -1,
    /** Whether every cell was weighed since the last cut, instance or close. */
    weighed = false
  const visible = (cell: number) => !!toldTo?.visible(instance, cell)
  /** Whether the cut's last image had `cell` stand for an actor it cannot draw. */
  const stands = (cell: number) => !!toldTo?.stands(instance, cell)
  /** Whether `cell` has an actor built: what the table says (`CHAIN_ACTOR`), the cut's own word. */
  const hasActor = (cell: number) => (chain!.actor[cell] & CHAIN_ACTOR.built) !== 0
  /** Whether `cell`'s actor is loaded: none without one; a top cell's always, else while its parent
   *  is wished — told so, or standing for an actor it cannot draw — or still visible. */
  const loaded = (cell: number) => {
    if (!hasActor(cell)) return false
    const up = chain!.parent[cell]
    return up < 0 || wished[up] === 1 || visible(up) || stands(up)
  }
  /** `cell`'s word may have moved. */
  const tell = (cell: number) => void toldDue.push(cell)
  /** The loads of `cell`'s children may have moved, and of theirs below a child that stands for an
   *  actor it cannot draw — whose standing follows its parent's wish. */
  const weighChildren = (cell: number) => {
    for (const child of below[cell]) {
      loadDue.push(child)
      if (!hasActor(child) || holds.failed(child)) weighChildren(child)
    }
  }
  /** The read priority of `cell`'s hold from `eye` looking along `axis`: the highest level first,
   *  then the square of the distance to its box over its grid's range times how far it lies behind
   *  the view — inside, first —; strictly after the view's own pages, in the visible band. */
  const priorityOf = (cell: number, eye: ArrayLike<number>, axis: ArrayLike<number>) => {
    const { bounds, level } = chain!
    const at = BOX_VALUES * cell,
      range = ranges[level[cell] + 1]
    const dx = eye[0] - clamp(eye[0], bounds[at], bounds[at + 3]),
      dy = eye[1] - clamp(eye[1], bounds[at + 1], bounds[at + 4]),
      dz = eye[2] - clamp(eye[2], bounds[at + 2], bounds[at + 5])
    const squared = dx * dx + dy * dy + dz * dz
    const cos = squared > 0 ? (axis[0] * dx + axis[1] * dy + axis[2] * dz) / Math.sqrt(squared) : -1
    const key = clamp(squared / (range * range), 0, 1) * (cos * 0.5 + 0.5)
    const order = (topLevel - level[cell] + key) / (topLevel + 1)
    return PRIORITY_VISIBLE + 0.5 + Math.floor(order * PRIORITY_STEPS) / (2 * PRIORITY_STEPS)
  }
  /** Each upper cell's wish from `eye`, the cells entering or leaving their range told again;
   *  whether the eye or the view axis moved. */
  const measure = (eye: ArrayLike<number>, axis: ArrayLike<number>) => {
    const eyeStill = keepNumbers(seenEye, eye)
    if (keepNumbers(seenAxis, axis) && eyeStill) return false
    if (eyeStill) return true
    for (const level of grids!.levels()) {
      let lists = wishedOf.get(level)
      if (!lists) wishedOf.set(level, (lists = [[], []]))
      const [before, now] = lists
      now.length = 0
      meeting = now
      grids!.near(level, eye[0], eye[2], meet)
      // Wished before and not met now: leaving.
      for (const cell of before) {
        if (wished[cell] !== 1) continue
        wished[cell] = 0
        tell(cell)
      }
      for (const cell of now) wished[cell] = 1
      lists[0] = now
      lists[1] = before
    }
    return true
  }
  /** The list a measure fills, and each cell met into it: kept (2) or entering (3), told again. */
  let meeting: number[] = []
  const meet = (cell: number) => {
    meeting.push(cell)
    if (wished[cell]) wished[cell] = 2
    else {
      wished[cell] = 3
      tell(cell)
    }
  }
  /** `cell`'s actor loaded or let go as it now is. */
  const load = (cell: number, eye: ArrayLike<number>, axis: ArrayLike<number>) => {
    const now = loaded(cell)
    if (now === (loadedNow[cell] === 1)) return
    loadedNow[cell] = Number(now)
    if (now) {
      loadedCells.add(cell)
      // A top holds within the tops' budget: held in their order once the settle knows them all.
      if (chain!.parent[cell] < 0) topsDue.push(cell)
      else holds.hold(cell, priorityOf(cell, eye, axis))
    } else {
      loadedCells.delete(cell)
      refusedTops.delete(cell)
      refused[cell] = 0
      holds.release(cell)
    }
    // Its hold's failure, or its end, moves its word.
    tell(cell)
  }
  /** The tops of `tops` held nearest first while the tops' budget takes them, the others refused
   *  — standing for nothing, their content following its range (`CELL_TOLD.refused`) — till room
   *  frees or the view moves. */
  const holdTops = (tops: number[], eye: ArrayLike<number>, axis: ArrayLike<number>) => {
    if (!tops.length) return
    for (const cell of tops) topOrder[cell] = priorityOf(cell, eye, axis)
    tops.sort((a, b) => topOrder[a] - topOrder[b])
    for (const cell of tops) {
      const fits = holds.fits(cell)
      if (fits) holds.hold(cell, topOrder[cell])
      if (Number(!fits) === refused[cell]) continue
      refused[cell] = Number(!fits)
      if (fits) refusedTops.delete(cell)
      else refusedTops.add(cell)
      tell(cell)
    }
    tops.length = 0
  }
  /** Each top's priority, as `holdTops` last ordered them. */
  const topOrder = new Float64Array(count)
  /** `cell` told what it is now; its children's loads weighed again once it moved. */
  const told = (cell: number) => {
    let word = wished[cell] ? CELL_TOLD.wished : 0
    if (placed[cell]) word |= CELL_TOLD.placed
    if (holds.failed(cell)) word |= CELL_TOLD.failed
    if (refused[cell]) word |= CELL_TOLD.refused
    if (toldWords[cell] === word) return
    toldWords[cell] = word
    toldTo?.show(instance, cell, word)
    weighChildren(cell)
  }
  /** Every cell due, settled: what a word told moves — what stands, so what loads — is read by the
   *  cut as soon as it is told, settled here again, never left for a camera move that may not
   *  come. */
  const settle = (eye: ArrayLike<number>, axis: ArrayLike<number>) => {
    while (toldDue.length || loadDue.length || topsDue.length) {
      for (let cell = toldDue.pop(); cell !== undefined; cell = toldDue.pop()) told(cell)
      for (let cell = loadDue.pop(); cell !== undefined; cell = loadDue.pop()) load(cell, eye, axis)
      holdTops(topsDue, eye, axis)
    }
  }
  return {
    /** The frame from `eye` looking along `axis` (unit, in the cells' frame), with the HLOD 0 cells
     *  the plan met (`leaves`): each cell that moved told to `cells`, as instance `at` of the world
     *  DAG; each loaded actor's roots held at its streaming order's priority, every other let go. */
    follow(
      leaves: ReadonlyMap<number, LeafWish>,
      eye: ArrayLike<number>,
      axis: ArrayLike<number>,
      cells: WorldCells | undefined,
      at: number,
    ) {
      if (!chain) return
      if (!weighed || cells !== toldTo || at !== instance) {
        // Another cut or instance was told nothing yet: every cell is told and weighed anew.
        toldWords.fill(0)
        toldTo = cells
        instance = at
        weighed = true
        for (let cell = 0; cell < count; cell++) {
          tell(cell)
          loadDue.push(cell)
        }
      }
      const turned = measure(eye, axis)
      for (const [cell, leaf] of leaves) {
        const wish = Number(leaf.wished),
          whole = Number(leaf.placed)
        if (wish || whole) leavesOn.add(cell)
        if (wished[cell] === wish && placed[cell] === whole) continue
        wished[cell] = wish
        placed[cell] = whole
        tell(cell)
      }
      for (const cell of leavesOn) {
        if (leaves.has(cell)) continue
        leavesOn.delete(cell)
        wished[cell] = placed[cell] = 0
        tell(cell)
      }
      // A cell whose visibility moved moves its children's loads.
      cells?.moved(at, weighChildren)
      // A hold failed or ended moves its cell's word, and may free room for a top refused; the
      // view moved, a nearer top refused may take a farther one's turn.
      const freed = holds.revision !== seenHolds
      if (freed) for (const cell of loadedCells) tell(cell)
      if (freed || turned) for (const cell of refusedTops) topsDue.push(cell)
      settle(eye, axis)
      seenHolds = holds.revision
      // The view turned: each hold still reading lifted to its priority now, when more urgent.
      if (turned) for (const cell of holds.reading()) holds.hold(cell, priorityOf(cell, eye, axis))
    },
    /** Whether HLOD cell `cell` was visible at the cut's last image. */
    visible,
    /** Whether HLOD cell `cell` stood, at the cut's last image, for an actor it cannot draw. */
    stands,
    /** Every cell let go: its roots, and what it was told. */
    close(cells: WorldCells | undefined, at: number) {
      for (const cell of holds.cells()) holds.release(cell)
      for (let cell = 0; cell < count; cell++) if (toldWords[cell]) cells?.show(at, cell, 0)
      wished.fill(0)
      placed.fill(0)
      loadedNow.fill(0)
      toldWords.fill(0)
      loadedCells.clear()
      refused.fill(0)
      refusedTops.clear()
      topsDue.length = 0
      leavesOn.clear()
      wishedOf.clear()
      toldDue.length = loadDue.length = 0
      seenEye.fill(NaN)
      seenAxis.fill(NaN)
      toldTo = undefined
      weighed = false
    },
  }
}
