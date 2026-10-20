/**
 * EVERY HLOD CELL'S ONE REPRESENTATION, SWITCHED ONLY ONCE ITS REPLACEMENT IS READY.
 *
 * A placement row that takes a cell's node — a cell placed — or gives it back — a cell left — tells
 * the cut which HLOD 0 cell it lies in (`placeInCell`); a row whose root the cut does not hold yet
 * counts in its cell as a placement not resident (`waitRow`). Each frame the partition tells each
 * HLOD cell whether it is wished — within its grid's loading range —, for an HLOD 0 cell whether
 * every cell file of it is placed, and whether its actor's hold failed for good (`show`,
 * `../../partition/hlodCells.ts`).
 *
 * Each cell is visible or not. An HLOD cell — one holding actors — turns visible once they are
 * ready and invisible once its own actor is: a switch before then would show a hole where the
 * replacement is not yet resident. An HLOD 0 cell holds the source meshes, which turn visible as
 * soon as the cell is loaded — nothing replaces them, so nothing is to wait for —: here it is
 * loaded once every cell file of it is placed and its placements resident. An actor is ready once every root of it that wears a page is
 * resident.
 *
 * A switch per cell alone would let a switching cell show both representations or neither for a
 * moment; the boss's rule — exactly one representation, never two, never none — adds two: a cell turns invisible only once
 * none of its children is visible, and visible only within a visible parent.
 *
 * A cell may have no actor to draw: a cell of objects in no HLOD layer — a top HLOD 0 cell, which
 * nothing stands for beyond its range (docs/COMPILER.md, HLOD) —, or one whose actor's build
 * failed, as the table tells apart (`CHAIN_ACTOR`); and an actor's hold may fail for good. A cell
 * of objects in no layer follows the plan's range alone, as any cell without an HLOD: it turns
 * invisible past it, and blocks nothing. Below
 * a parent, the boss's rule — never none — keeps the content of a cell with no actor to draw
 * standing for it: it is wished while its parent is, or while its parent shows and it does not —
 * a top cell whose actor failed always —, turns invisible only once its parent is, its parent
 * turning invisible over it as over a hidden child, and counts, for its parent's switch, as ready
 * once its own content is. More detail far off there, never a hole, and never a chain held up. A
 * top whose actor the tops' budget refused (`CELL_TOLD.refused`) stands for nothing: its content
 * follows its range, as a cell's with no actor — the budget is never passed by its children.
 *
 * An actor's roots resident are not all it shows: its flattened material's atlas streams by tiles
 * the image asks once it is drawn. A switch that draws an actor not drawn yet — its cell turning
 * invisible, or its parent visible — waits until its textures are warm too (`warmWith`, the level
 * matching its pixels resident, `../../webgpu/pages/prepare/hlodWarm.ts`), asked again each cut
 * while it waits — every child of a switching cell asked at once, their textures warming
 * together —: never a blurred atlas at the switch.
 *
 * What draws is then: a cell's actor while the cell holding it — its parent; none for a top cell,
 * whose actor is always loaded — is visible and the cell is not; a visible HLOD 0 cell's
 * placements; and the placements of an HLOD 0 cell wished but not yet visible ask for their pages,
 * drawing none (`CELL_DRAW.asking`).
 *
 * Readiness is counted by difference: per cell and instance, its actor's roots not resident and,
 * for an HLOD 0 cell, its placements whose roots are not, moved by the residency changes the cut
 * receives and by the links that move. Only the cells something moved for are switched again, with
 * their parent and children when one switches. The words that moved go up behind the cold records
 * before the next cut, joined into writes by the cut's one run writer (`runWrites.ts`); the cut
 * made before them is then not the cut made now (`runtime.ts`).
 */
import type { PageResidency, ResidencyChanges } from '../core/selection.ts'
import type { PackedDag } from './types.ts'
import { writeRanges, type RangeTarget } from './runWrites.ts'
import { createChangedRuns } from '../../webgpu/residency/ranges.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { CELL_DRAW, LINK_WORDS, setLink } from './worldLinks.ts'
import { CHAIN_ACTOR, chainChildren } from '../../../../sdk-core/src/manifest/worldRoots.ts'

/** What the partition tells of a cell (`show`), bit by bit: wished, every cell file of an HLOD 0
 *  cell placed, its actor's hold failed for good, a top's actor refused by the tops' budget — not
 *  held, standing for nothing: its content follows its range as a cell with no actor's. */
export const CELL_TOLD = { wished: 1, placed: 2, failed: 4, refused: 8 } as const

/** What a switch that draws an HLOD actor asks of its textures (`warmWith`): whether they are warm
 *  for `cell` of `instance`, and that its actor now draws — a wait given up ends there. */
export type ActorWarmth = {
  ready(instance: number, cell: number): boolean
  drawn(instance: number, cell: number): void
}

/** The follower of the world's cells in `packed`'s cold words; none without a world DAG. A member
 *  of the run (`runtime.ts`): `placeInCell` moves a link, `waitRow` a row without its root, `show`
 *  what a cell is told, every residency the cut receives moves the readiness (`residency`), and
 *  every cut takes the moves up first (`sync`). */
export function createLinkFollower(resources: { packed: PackedDag; cold: RangeTarget }) {
  const { packed, cold } = resources,
    world = packed.world
  if (!world) return undefined
  const { links, states, cells, roots, rootsOf, hlod, parent, layer, actor } = world
  const slots = links.length / LINK_WORDS,
    instances = roots.length,
    ranks = hlod.length
  /** Each cell's children: the cells whose actors lie in it. */
  const below = chainChildren(parent)
  /** The instance each placement of the world DAG is, -1 for any other. */
  const instanceOf = new Int32Array(Math.max(slots, packed.worldCount)).fill(-1)
  roots.forEach((w, k) => (instanceOf[w] = k))
  /** Whether each world rank is a root that wears a page, and whether it was resident in each
   *  instance. */
  const isRoot = new Uint8Array(ranks)
  for (const list of rootsOf) for (const rank of list) isRoot[rank] = 1
  const rootResident = new Uint8Array(ranks * instances)
  /** Per cell and instance: its actor's roots not resident, its placements not resident — linked
   *  whose roots are not, or rows whose root the cut lacks —, what it was told (`CELL_TOLD`),
   *  whether it is visible, and whether it waits to be switched again. */
  const missing = new Int32Array(cells * instances),
    unready = new Int32Array(cells * instances),
    told = new Uint8Array(cells * instances),
    visible = new Uint8Array(cells * instances),
    queued = new Uint8Array(cells * instances)
  for (let k = 0; k < instances; k++)
    rootsOf.forEach((list, h) => (missing[k * cells + h] = list.length))
  /** The cell slots waiting to be switched again: every one at first, its word written. */
  const pending: number[] = []
  for (let at = cells * instances - 1; at >= 0; at--) {
    queued[at] = 1
    pending.push(at)
  }
  /** Whether each linked placement's roots were resident as last counted. */
  const covered = new Uint8Array(slots)
  /** The residency (`residency`) each linked placement was last counted at: its pages moving
   *  together count it once. */
  const recountedAt = new Uint32Array(slots)
  let residencies = 0
  /** Per row list, the cell slot each of its rows without a root counts in (`waitRow`). */
  const waiting = new Map<object, Map<number, number>>()
  /** The rows' flags the cut last received, and how many times a cell's visibility moved. */
  let rows: PageResidency | undefined,
    revision = 0
  /** Per instance, the cells whose visibility moved since its follower last asked (`moved`); all
   *  of them once more moved than it has cells. */
  const shownMoved: number[][] = Array.from({ length: instances }, () => []),
    shownAll = new Uint8Array(instances).fill(1)
  const movedLinks = createChangedRuns(),
    movedStates = createChangedRuns()
  const linkWords = { data: links, sourceBase: 0, targetBase: world.linkBase, stride: LINK_WORDS },
    stateWords = { data: states, sourceBase: 0, targetBase: world.stateBase, stride: 1 }

  /** Whether an actor's textures are warm (`warmWith`), and the cell slots whose switch waits on
   *  them, switched again at each cut till they are. */
  let warmth: ActorWarmth | undefined
  const warming = new Set<number>()
  /** Whether cell `cell` at `base`'s actor, about to draw, is warm; else the switch of slot `asker`
   *  waits for it. */
  const warm = (base: number, cell: number, asker: number) => {
    if (!warmth || warmth.ready(base / cells, cell)) return true
    warming.add(asker)
    return false
  }
  /** Cell slot `at` waits to be switched again. */
  const mark = (at: number) => {
    if (queued[at]) return
    queued[at] = 1
    pending.push(at)
  }
  /** Cell slot `at`, and its parent's — whose readiness its actor is part of —, up the chain while
   *  that parent has no actor to draw: a hidden child's readiness reaches the first ancestor that
   *  hides over it (`childrenHide`). */
  const markWithParent = (at: number) => {
    mark(at)
    const base = at - (at % cells)
    for (let up = parent[at % cells]; up >= 0; up = parent[up]) {
      mark(base + up)
      if (usable(base, up)) break
    }
  }
  /** Whether cell `cell` at `base` has an actor that stands for its content when it cannot draw:
   *  built or failed (`CHAIN_ACTOR`), not refused by the tops' budget — none for a cell of objects
   *  in no layer. */
  const hasActor = (base: number, cell: number) =>
    actor[cell] !== 0 && (told[base + cell] & CELL_TOLD.refused) === 0
  /** Whether cell `cell` at `base` has an actor to draw: built, with a root that wears a page, its
   *  hold neither failed for good nor refused. */
  const usable = (base: number, cell: number) =>
    (actor[cell] & CHAIN_ACTOR.built) !== 0 &&
    rootsOf[cell].length > 0 &&
    (told[base + cell] & (CELL_TOLD.failed | CELL_TOLD.refused)) === 0
  /** Whether cell `cell` at `base`, with no actor to draw, must show its content for it: its parent
   *  wished, or visible while it is not — its actor lost under a visible parent —; at the top, for
   *  a failed actor always, with no actor never (the boss's rule). */
  const standsFor = (base: number, cell: number) => {
    const up = parent[cell]
    if (up < 0) return hasActor(base, cell)
    return (visible[base + up] === 1 && visible[base + cell] === 0) || wanted(base, up)
  }
  /** Whether cell `cell` at `base` is wished: told so, or — with no actor to draw — standing for
   *  it (`standsFor`). */
  const wanted = (base: number, cell: number): boolean =>
    (told[base + cell] & CELL_TOLD.wished) !== 0 || (!usable(base, cell) && standsFor(base, cell))
  /** Whether cell `cell` at `base` may turn visible: an HLOD 0 cell's level loaded, an upper cell's
   *  children each represented — its actor ready, visible itself, or with no actor to draw its own
   *  content ready, turning visible with it (`CanMakeVisible`, the boss's rule). */
  const canMakeVisible = (base: number, cell: number, asker = base + cell): boolean => {
    const at = base + cell
    if (layer[cell] === 0) return (told[at] & CELL_TOLD.placed) !== 0 && unready[at] === 0
    // Every child asked, none left for the next: their textures warm together.
    let ready = true
    for (const child of below[cell]) {
      if (visible[base + child]) continue
      if (!usable(base, child)) ready = canMakeVisible(base, child, asker) && ready
      else ready = warm(base, child, asker) && missing[base + child] === 0 && ready
    }
    return ready
  }
  /** Whether each child of cell `cell` at `base` is invisible, or hides with it: no actor to draw,
   *  no longer wished, and its own children so. */
  const childrenHide = (base: number, cell: number): boolean => {
    for (const child of below[cell]) {
      if (!visible[base + child]) continue
      if (usable(base, child) || wanted(base, child) || !childrenHide(base, child)) return false
    }
    return true
  }
  /** Whether cell `cell` at `base` may turn invisible: its children invisible or hiding with it —
   *  the boss's rule — and its own actor ready; with no actor to draw, its parent invisible, or
   *  none: no actor of its stands where its content goes (`CanMakeInvisible`). */
  const canMakeInvisible = (base: number, cell: number) => {
    if (!childrenHide(base, cell)) return false
    if (usable(base, cell)) return missing[base + cell] === 0 && warm(base, cell, base + cell)
    const up = parent[cell]
    return up < 0 || visible[base + up] === 0
  }
  /** Cell slot `at` switched where it may, its word written; its parent and children switched
   *  again once it switched. */
  const settle = (at: number) => {
    queued[at] = 0
    const cell = at % cells,
      base = at - cell,
      up = parent[cell]
    const wished = wanted(base, cell),
      within = up < 0 || visible[base + up] === 1
    const was = visible[at]
    if (was && !wished && canMakeInvisible(base, cell)) visible[at] = 0
    else if (!was && wished && within && canMakeVisible(base, cell)) visible[at] = 1
    const actor = !visible[at] && within ? CELL_DRAW.hlod : 0
    const own =
      layer[cell] !== 0 ? 0 : visible[at] ? CELL_DRAW.placements : wished ? CELL_DRAW.asking : 0
    if (states[at] !== (actor | own)) {
      states[at] = actor | own
      movedStates.mark(at)
    }
    if (visible[at] === was) return
    revision++
    const k = base / cells,
      moved = shownMoved[k]
    // The actors this switch draws now: its own, or its children's.
    if (warmth && !visible[at]) warmth.drawn(k, cell)
    else if (warmth)
      for (const child of below[cell]) if (!visible[base + child]) warmth.drawn(k, child)
    if (!shownAll[k] && moved.push(cell) > cells) {
      shownAll[k] = 1
      moved.length = 0
    }
    if (up >= 0) mark(base + up)
    // Its children's wish may follow it, and theirs below a child with no actor to draw.
    markBelow(base, cell)
  }
  /** The children of cell `cell` at `base`, and theirs below a child with no actor to draw. */
  const markBelow = (base: number, cell: number) => {
    for (const child of below[cell]) {
      mark(base + child)
      if (!usable(base, child)) markBelow(base, child)
    }
  }
  /** Every cell waiting, switched; those whose switch waits on an actor warming asked again. */
  const resolve = () => {
    for (const at of warming) mark(at)
    warming.clear()
    for (let at = pending.pop(); at !== undefined; at = pending.pop()) settle(at)
  }
  /** Whether every root of placement `w`'s cover is resident in the rows last received: a
   *  primitive without its group structure is all roots. */
  const coverResident = (w: number) => {
    if (!rows) return false
    const { structure, pageBase: base, pageCount: count } = packed.cutLinks[w]
    if (structure) {
      for (const root of structure.roots) if (!rows.flag(base + root)) return false
      return true
    }
    for (let page = base; page < base + count; page++) if (!rows.flag(page)) return false
    return true
  }
  /** The cell slot placement `w` counts in, -1 for none. */
  const linkedAt = (w: number) => {
    const h = links[w * LINK_WORDS]
    return h === NO_INDEX ? -1 : links[w * LINK_WORDS + 1] * cells + h
  }
  /** Cell slot `at` gains `count` placements not resident. */
  const unreadyBy = (at: number, count: number) => {
    unready[at] += count
    mark(at)
  }
  /** Placement `w`'s roots counted again, once a residency: its cell's readiness moved with
   *  them. */
  const recount = (w: number) => {
    const at = linkedAt(w)
    if (at < 0 || recountedAt[w] === residencies) return
    recountedAt[w] = residencies
    const now = coverResident(w) ? 1 : 0
    if (covered[w] === now) return
    covered[w] = now
    unreadyBy(at, now ? -1 : 1)
  }
  /** Packed page `page`'s flag moved, or may have. */
  const pageMoved = (page: number) => {
    const w = rootOfPacked(packed.pageIndex, page)
    if (w < 0) return
    const k = instanceOf[w]
    if (k < 0) return void recount(w)
    const rank = page - packed.cutLinks[w].pageBase
    if (!isRoot[rank]) return
    const now = rows!.flag(page) ? 1 : 0,
      seen = k * ranks + rank
    if (rootResident[seen] === now) return
    rootResident[seen] = now
    const at = k * cells + hlod[rank]
    missing[at] += now ? -1 : 1
    markWithParent(at)
  }
  /** The words `moved` names of `words`, sent. */
  const send = (moved: ReturnType<typeof createChangedRuns>, words: typeof linkWords) => {
    if (!moved.count) return
    const sorted = moved.take()
    writeRanges(cold, sorted, sorted.length, words)
  }
  return {
    /** The rows' flags `next` reach the cut, changed at `changes` (every page without): the
     *  readiness follows. */
    residency(next: PageResidency, changes?: ResidencyChanges) {
      rows = next
      residencies++
      if (changes) for (let i = 0; i < changes.count; i++) pageMoved(changes.pages[i])
      else for (let page = 0; page < next.length; page++) pageMoved(page)
    },
    /** Placement `w` lies in HLOD 0 cell `cell` of the world DAG's instance `instance` now, or in
     *  none (`-1`): what it counted moves with it. */
    placeInCell(w: number, cell: number, instance = 0) {
      // A placement of the world DAG itself lies in no cell.
      if (w >= slots || instanceOf[w] >= 0) return
      const before = linkedAt(w)
      if (!setLink(world, w, cell, instance)) return
      movedLinks.mark(w)
      if (before >= 0 && !covered[w]) unreadyBy(before, -1)
      const at = linkedAt(w)
      if (at < 0) return
      covered[w] = coverResident(w) ? 1 : 0
      if (!covered[w]) unreadyBy(at, 1)
    },
    /** Row `index` of the row list `key`, whose root the cut does not hold yet, lies in HLOD 0 cell
     *  `cell` of instance `instance`, or in none (`-1`, its root held or the row left): until then
     *  it counts in that cell as a placement not resident. */
    waitRow(key: object, index: number, cell: number, instance: number) {
      let rowsOf = waiting.get(key)
      const before = rowsOf?.get(index) ?? -1,
        at = cell >= 0 && cell < cells && instance < instances ? instance * cells + cell : -1
      if (before === at) return
      if (before >= 0) unreadyBy(before, -1)
      if (at >= 0) {
        if (!rowsOf) waiting.set(key, (rowsOf = new Map()))
        rowsOf.set(index, at)
        unreadyBy(at, 1)
      } else rowsOf!.delete(index)
    },
    /** HLOD cell `cell` of instance `instance` is told `word` (`CELL_TOLD`); whether it moved. */
    show(instance: number, cell: number, word: number) {
      if (instance >= instances || cell >= cells) return false
      const at = instance * cells + cell
      if (told[at] === word) return false
      told[at] = word
      markWithParent(at)
      // A wish, or an actor lost, moves the wish of the cells below that stand for theirs.
      markBelow(instance * cells, cell)
      return true
    },
    /** Whether cell `cell` of instance `instance` stood, at the last cut, for an actor it cannot
     *  draw, wished by its parent — a top cell for its failed actor —: its content is wished for it
     *  (the boss's rule). A cell with no actor and no parent stands for nothing. */
    stands(instance: number, cell: number) {
      if (instance >= instances || cell >= cells) return false
      const base = instance * cells
      return !usable(base, cell) && standsFor(base, cell)
    },
    /** Whether cell `cell` of instance `instance` was visible at the last cut. */
    visible: (instance: number, cell: number) =>
      instance < instances && cell < cells && visible[instance * cells + cell] === 1,
    /** A switch that draws an actor waits until `ready` says its textures are warm, asked again at
     *  each cut while it waits, and tells it each actor it draws; none, it waits for nothing past
     *  its roots. */
    warmWith(next?: ActorWarmth) {
      warmth = next
    },
    /** Whether a switch waits on an actor's textures: the view keeps drawing till it is done. */
    get warming() {
      return warming.size > 0
    },
    /** Each cell of instance `instance` whose visibility moved since the last call for it, told to
     *  `visit` — at the first call, or after more moves than cells, every cell. */
    moved(instance: number, visit: (cell: number) => void) {
      if (instance >= instances) return
      if (shownAll[instance]) {
        for (let cell = 0; cell < cells; cell++) visit(cell)
        shownAll[instance] = 0
      } else for (const cell of shownMoved[instance]) visit(cell)
      shownMoved[instance].length = 0
    },
    /** Advanced whenever a cell's visibility moved. */
    get revision() {
      return revision
    },
    /** Before every cut: the cells waiting switched, the links and words that moved go up; whether
     *  any did. */
    sync() {
      resolve()
      const moved = movedLinks.count + movedStates.count > 0
      send(movedLinks, linkWords)
      send(movedStates, stateWords)
      return moved
    },
    /** Bytes of its host tables. */
    get hostBytes() {
      return (
        instanceOf.byteLength +
        isRoot.byteLength +
        rootResident.byteLength +
        missing.byteLength +
        unready.byteLength +
        told.byteLength +
        visible.byteLength +
        queued.byteLength +
        covered.byteLength +
        movedLinks.byteLength +
        movedStates.byteLength
      )
    },
  }
}

export type LinkFollower = NonNullable<ReturnType<typeof createLinkFollower>>
