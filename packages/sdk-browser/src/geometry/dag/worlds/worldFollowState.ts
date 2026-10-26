/**
 * WHAT THE WORLD'S FOLLOWER HOLDS (`worldFollow.ts`): the tables of its cells, the parts that count
 * them, and the switch of one cell (`settle`) that every cut takes up first.
 */
import type { PackedDag } from '../types.ts'
import type { RangeSource } from '../runWrites.ts'
import { createChangedRuns } from '../../residency/ranges.ts'
import { CELL_DRAW, LINK_WORDS, cellChildren, type PackedWorld } from './worldLinks.ts'
import { createMarkStack } from './worldMarks.ts'
import { createWorldFiles } from './worldFiles.ts'
import { createWorldPlacements } from './worldPlacements.ts'
import { createCellReadiness } from './worldReady.ts'
import { createSwitchedPages } from './worldSwitched.ts'
import { createSwitchWarmth } from './worldWarm.ts'
import { createVisibilityMoves } from './worldMoves.ts'
import { createUnshown } from './worldUnshown.ts'

/** What the partition tells of a cell (`show`), bit by bit: wished, every cell file of an HLOD 0
 *  cell placed, its actor's hold failed for good — it stands for nothing —, a file of it refused
 *  for good — never placed whole: nothing waits for its content (`shown`) —, its rows placed. */
export const CELL_TOLD = { wished: 1, placed: 2, failed: 4, lost: 8, rows: 16 } as const

/** The words of each table the follower sends up. */
type FollowWords = { link: RangeSource; state: RangeSource; file: RangeSource }

/** What the follower holds, per cell and instance unless said:
 *  - `below`, each cell's children: the cells whose actors lie in it;
 *  - `told`, what it was told (`CELL_TOLD`), and `visible`, whether it is visible;
 *  - `unshown`, the cell slots wished and not visible at their last switch — an actor drawn for
 *    them, or nothing —, their content not lost (`CELL_TOLD.lost`);
 *  - `blockOn`, per instance, the cell files a load blocking on slow streaming waits for
 *    (`blockingLoad`);
 *  - `marks`, the cell slots waiting to be switched again: every one at first, its word written;
 *  - `revision`, how many times a cell's or a file's visibility moved, and `refile`, whether every
 *    file's word is to be switched again at the next sync;
 *  - `moves`, the cells whose visibility moved per instance (`worldMoves.ts`), and `movedStates`,
 *    the words moved;
 *  - `warmth`, the warm-ups the switches that draw an actor wait on (`worldWarm.ts`);
 *  - `files` (`worldFiles.ts`), `placed` (`worldPlacements.ts`), `switchedPages`
 *    (`worldSwitched.ts`), `ready` (`worldReady.ts`) and `visit`, the switch of a cell slot marked. */
export type Follow = {
  packed: PackedDag
  world: PackedWorld
  instances: number
  below: readonly (readonly number[])[]
  told: Uint8Array
  visible: Uint8Array
  unshown: ReturnType<typeof createUnshown>
  blockOn: (ReadonlySet<number> | undefined)[]
  marks: ReturnType<typeof createMarkStack>
  revision: number
  refile: boolean
  moves: ReturnType<typeof createVisibilityMoves>
  movedStates: ReturnType<typeof createChangedRuns>
  warmth: ReturnType<typeof createSwitchWarmth>
  files: ReturnType<typeof createWorldFiles>
  placed: ReturnType<typeof createWorldPlacements>
  switchedPages: ReturnType<typeof createSwitchedPages>
  ready: ReturnType<typeof createCellReadiness>
  visit: (at: number) => void
}

/** The links', the states' and the files' words of `world`, as the cut's run writer takes them. */
export const followWords = (world: PackedWorld): FollowWords => ({
  link: { data: world.links, sourceBase: 0, targetBase: world.linkBase, stride: LINK_WORDS },
  state: { data: world.states, sourceBase: 0, targetBase: world.stateBase, stride: 1 },
  file: { data: world.files, sourceBase: 0, targetBase: world.fileBase, stride: 1 },
})

/** Cell slot `at` waits to be switched again, and its parent's, whose load counts its actor. */
function markWithParent(marks: Follow['marks'], world: PackedWorld, at: number) {
  const cell = at % world.cells
  marks.mark(at)
  if (world.parent[cell] >= 0) marks.mark(at - cell + world.parent[cell])
}

/** Every cell slot waits to be switched again. */
export function markAll(marks: Follow['marks'], slots: number) {
  for (let at = slots - 1; at >= 0; at--) marks.mark(at)
}

/** The follower's state over `world` of `packed`, every cell marked to be switched. */
export function createFollowState(packed: PackedDag, world: PackedWorld): Follow {
  const { parent, cells, actor } = world
  const instances = world.roots.length,
    slots = cells * instances
  const below = cellChildren(parent)
  const told = new Uint8Array(slots),
    visible = new Uint8Array(slots)
  const warmth = createSwitchWarmth(actor, cells)
  const marks = createMarkStack(slots)
  markAll(marks, slots)
  const files = createWorldFiles(world.files, instances, () => warmth.drawn)
  const placed = createWorldPlacements(packed, world, files, {
    mark: marks.mark,
    markWithParent: (at: number) => markWithParent(marks, world, at),
  })
  const s: Follow = {
    packed,
    world,
    instances,
    below,
    told,
    visible,
    unshown: createUnshown(slots),
    blockOn: [],
    marks,
    revision: 0,
    refile: false,
    moves: createVisibilityMoves(instances, cells),
    movedStates: createChangedRuns(),
    warmth,
    files,
    placed,
    switchedPages: createSwitchedPages(packed, world),
    ready: createCellReadiness({
      world,
      below,
      told,
      visible,
      missing: placed.missing,
      unready: placed.unready,
      warmth,
      bits: CELL_TOLD,
    }),
    visit: (at) => settle(s, at),
  }
  return s
}

/** The actors in cell `cell` at `base` — its children's — drawn or let go. */
function releaseIn(s: Follow, base: number, cell: number) {
  for (const child of s.below[cell]) s.warmth.release(base, child)
}

/** Whether cell slot `at` is visible now: shown or hidden where it may, as it is wished and
 *  loaded and warmed up — the visible it was, otherwise. */
function nextVisible(s: Follow, at: number, wished: boolean) {
  const cell = at % s.world.cells,
    base = at - cell
  const was = s.visible[at]
  if (was && !wished && s.ready.warmedOut(base, cell)) return 0
  if (
    !was &&
    wished &&
    !s.warmth.blocking &&
    s.ready.loaded(base, cell) &&
    s.ready.warmedIn(base, cell)
  )
    return 1
  return was
}

/** Cell slot `at`'s draw word written, its pages told to move, if it moved. */
function writeState(s: Follow, at: number) {
  const { states, layer, parent, cells } = s.world
  const cell = at % cells,
    base = at - cell,
    up = parent[cell]
  // The HLOD actors off, no cell draws its actor, nor its placements as its HLOD 0 actor. The
  // cells only loaded, none is shown: the actors always loaded (`up < 0`) draw over every cell,
  // and one a cell holds has no cell shown to be drawn in.
  const held = s.warmth.drawn,
    shown = s.visible[at] === 1 && held,
    within = up < 0 || (s.visible[base + up] === 1 && held),
    on = s.warmth.hlodOn
  const stands = on && !shown && within ? CELL_DRAW.hlod : 0
  const own = on && layer[cell] === 0 && shown ? CELL_DRAW.placements : 0
  if (states[at] === (stands | own)) return
  s.switchedPages.cellMoved(at, states[at] ^ (stands | own))
  states[at] = stands | own
  s.movedStates.mark(at)
}

/** Cell slot `at` switched where it may, its word written; its children switched again once it
 *  switched — their actors draw as it shows or hides. */
function settle(s: Follow, at: number) {
  const { cells } = s.world
  const cell = at % cells,
    base = at - cell
  const wished = (s.told[at] & CELL_TOLD.wished) !== 0
  const was = s.visible[at]
  s.visible[at] = nextVisible(s, at, wished)
  writeState(s, at)
  s.unshown.set(at, wished && !s.visible[at] && (s.told[at] & CELL_TOLD.lost) === 0)
  if (s.visible[at] === was) {
    // Hidden and wished no more, it lets the actors in it go.
    if (!s.visible[at] && !wished) releaseIn(s, base, cell)
    return
  }
  // Shown, it draws the actors in it; hidden, it lets them go and shows its own.
  releaseIn(s, base, cell)
  if (!s.visible[at]) s.warmth.release(base, cell)
  s.revision++
  s.moves.note(base / cells, cell)
  for (const child of s.below[cell]) s.marks.mark(base + child)
}

/** The cells and files waiting switched, the links and words that moved ready to go up: whether
 *  any moved. */
export function settleAll(s: Follow, heldBack: (key: number) => boolean) {
  s.warmth.again(s.marks.mark)
  s.marks.drain(s.visit)
  const redo = s.refile
  s.refile = false
  if (s.files.settle(s.warmth.blocking ? heldBack : undefined, redo)) {
    s.switchedPages.fileMoved()
    s.revision++
  }
  return s.placed.movedLinks.count + s.movedStates.count + s.files.moved.count > 0
}

/** Cell slot `at` of the world told `word` (`CELL_TOLD`), its readiness and its parent's marked. */
export function tell(s: Follow, at: number, word: number) {
  // Its actor's rows placed or parked count in its readiness (`worldPlacements.ts`).
  if ((s.told[at] ^ word) & CELL_TOLD.rows) s.placed.missing[at] += word & CELL_TOLD.rows ? -1 : 1
  s.told[at] = word
  // Its parent's load counts its actor, whose hold may have failed.
  markWithParent(s.marks, s.world, at)
}
