/**
 * THE WORLD'S HLOD IN THE ONE CUT, AND EACH CELL'S ONE REPRESENTATION.
 *
 * The cook builds the world's HLOD chain (`world-roots.dag`, `compiler_world_roots.rs`): per HLOD
 * cell of each layer, the actor of the next — HLOD 1 per HLOD 0 cell, HLOD 2 per HLOD 1 cell, HLOD 3
 * per HLOD 2 cell —, each its own DAG with its true errors. Packed in the one cut as its last root
 * (`scene/worldHlod.ts`) — one per placement of its model, each at its pose, all sharing the
 * records and the culling hierarchy, each with its own pages —, it is cut by the one rule at the one
 * threshold, as any primitive.
 *
 * What draws a cell is the HLOD switch: an HLOD actor is
 * visible while it is loaded and the cell its sources stream in is not visible. Per HLOD cell and
 * instance, one word says what draws there (`CELL_DRAW`): a visible HLOD 0 cell's placements — the
 * source meshes, and HLOD 0, the same meshes instanced —, or
 * the cell's own actor of the next layer while the cell holding it is visible and the cell itself
 * is not, or nothing of its own. The host keeps each cell's visibility (`worldFollow.ts`), switched
 * only once what replaces it is ready, so a switch never opens a hole; the placements of a cell wished but not yet
 * visible ask for their pages meanwhile and draw none (`CELL_DRAW.asking`).
 *
 * Behind the cold records: three header words — the first of the per-rank cell words, the first of
 * the state words, the cell count —, then per placement slot its link — its HLOD 0 cell and the
 * instance of the world DAG it lies in, `NO_INDEX` for none; a placement of the world DAG itself
 * names its instance alone —, then per world rank its HLOD cell, read by its rank in any instance,
 * then the states, cell after cell for each instance. The descent reads them
 * (`shader/worldGateWgsl.ts`): a placement whose cell neither draws nor asks for its placements
 * opens nothing, and a world cluster whose cell does not draw its actor is neither drawn nor asked
 * for.
 *
 * Cost a frame: one word read per placement prepared and per world page tested, and the state words
 * that moved written; nothing scans the world.
 */
import type { DagCutLinks, DagRoot } from './types.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** The root mark's bit on each placement of the world DAG (`ClusterRoot.mark`): a ray meets none
 *  of it, and the placement tree opens it from queue 0 (`placementTreePack.ts`), never through a
 *  group. */
export const WORLD_ROOT_MARK = 16

/** What an HLOD cell's word draws, bit by bit (`worldFollow.ts`): a visible HLOD 0 cell's
 *  placements, the cell's own actor of the next layer, and the placements of an HLOD 0 cell wished
 *  but not yet visible asking for their pages and drawing none. Zero: nothing of its own. */
export const CELL_DRAW = { placements: 1, hlod: 2, asking: 4 } as const
/** The bits of a word that keep an HLOD 0 cell's placements: drawn, or asking. */
export const PLACEMENT_BITS = CELL_DRAW.placements | CELL_DRAW.asking

/** Words before the links: the first per-rank cell word, the first state word, the cell count. */
export const LINK_HEADER = 3
/** Words a placement's link takes: its HLOD 0 cell and its instance of the world DAG. */
export const LINK_WORDS = 2

/** The world DAG's placements — one per placement of its model, instance `k` the `k`-th —, each
 *  world rank's HLOD cell, the chain of cells, the links of every placement slot at `linkBase`, and
 *  the state words at `stateBase`, `cells` per instance, their host copy `states`. */
export type PackedWorld = {
  /** The placements of the world DAG, instance by instance: every one shares its records, each its
   *  own pages, pose and residency. */
  roots: readonly number[]
  /** Each world rank's HLOD cell. */
  hlod: Int32Array
  /** How many HLOD cells the chain holds, the HLOD 0 cells first, each layer after the one below. */
  cells: number
  /** Each cell's parent in the chain, -1 for a top cell, and its layer. */
  parent: Int32Array
  layer: Uint8Array
  /** Per HLOD cell, the world ranks nothing replaces that wear a page: what must be resident
   *  before its actor is ready. */
  rootsOf: readonly number[][]
  /** `LINK_WORDS` per placement slot (`setLink`). */
  links: Uint32Array
  linkBase: number
  /** The state of cell `h` of instance `k` at `k · cells + h`, and where they lie in the cold
   *  table. */
  states: Uint32Array
  stateBase: number
}

/** The words the world takes behind the cold records for `worldCount` placement slots, its
 *  `pageCount` ranks, `cells` HLOD cells and `instances` placements of its model. */
export const worldLinkWords = (
  worldCount: number,
  pageCount: number,
  cells: number,
  instances: number,
) => LINK_HEADER + LINK_WORDS * worldCount + pageCount + cells * instances

/** Per HLOD cell of `root`'s `cells`, the ranks of its structure nothing replaces that wear a
 *  page: a root no surface wears is no page (`../../scene/worldRecords.ts`), never resident, and
 *  nothing to wait for. */
function cellRoots(root: DagRoot, cells: number) {
  const rootsOf: number[][] = Array.from({ length: cells }, () => [])
  for (const rank of root.structure?.roots ?? [])
    if (root.pages[rank].url) rootsOf[root.hlod!.cells[rank]].push(rank)
  return rootsOf
}

/**
 * The world DAG of `roots`, packed at its placements `worlds` with `cutLinks`, its words written
 * into the cold table `cold` from `at` for `slots` placement slots — those a growth appends
 * included —: the header, no link until a placement says which cell it lies in
 * (`GpuSelection.placeInCell`, `worldFollow.ts`) — a placement of the world DAG naming its
 * instance —, each rank's cell, then every state drawing nothing until the host walks it.
 */
export function packWorldLinks(
  roots: readonly DagRoot[],
  worlds: readonly number[],
  slots: number,
  { cutLinks, cold, at }: { cutLinks: readonly DagCutLinks[]; cold: Uint32Array; at: number },
): PackedWorld {
  const root = roots[worlds[0]],
    { cells: hlod, parent, layer } = root.hlod!,
    cells = parent.length
  const linkBase = at + LINK_HEADER
  const links = new Uint32Array(LINK_WORDS * Math.max(slots, roots.length)).fill(NO_INDEX)
  worlds.forEach((w, k) => (links[w * LINK_WORDS + 1] = k))
  const hlodBase = linkBase + links.length,
    stateBase = hlodBase + cutLinks[worlds[0]].pageCount
  // Every word is resolved before the first cut (`worldFollow.ts`, `sync`).
  const states = new Uint32Array(cells * worlds.length)
  cold[at] = hlodBase
  cold[at + 1] = stateBase
  cold[at + 2] = cells
  cold.set(links, linkBase)
  cold.set(hlod, hlodBase)
  cold.set(states, stateBase)
  return {
    roots: worlds,
    hlod,
    cells,
    parent,
    layer,
    rootsOf: cellRoots(root, cells),
    links,
    linkBase,
    states,
    stateBase,
  }
}

/** Placement `w` of `world` lies in HLOD 0 cell `cell` of instance `instance` now, or none (`-1`):
 *  its words written in `world.links`; whether they moved. A cell no HLOD 0 cell of the chain is
 *  refused, `WORLD_CELL_RANGE`: no state follows it. An instance the cut does not pack yet links
 *  none: no actor of it is drawn, its placements alone stand for it until a growth packs it. */
export function setLink(world: PackedWorld, w: number, cell: number, instance: number) {
  if (cell >= world.cells || (cell >= 0 && world.layer[cell] !== 0))
    throw new Error(`WORLD_CELL_RANGE: placement ${w} in cell ${cell}, no HLOD 0 cell of the chain`)
  const at = w * LINK_WORDS,
    { links } = world,
    linked = cell >= 0 && instance < world.roots.length
  const next = linked ? cell : NO_INDEX
  if (links[at] === next && (!linked || links[at + 1] === instance)) return false
  links[at] = next
  links[at + 1] = linked ? instance : NO_INDEX
  return true
}
