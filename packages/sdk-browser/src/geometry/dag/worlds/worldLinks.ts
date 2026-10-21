/**
 * THE WORLD'S HLOD IN THE ONE CUT, AND WHAT DRAWS EACH CELL AND EACH CELL FILE.
 *
 * The cook builds the world's HLOD chain (`world-roots.dag`, `hlod/chain.rs`): per HLOD
 * cell of each layer, the actor of the next — HLOD 1 per HLOD 0 cell, HLOD 2 per HLOD 1 cell, HLOD 3
 * per HLOD 2 cell —, each its own DAG with its true errors and its own subtree of the world's
 * culling hierarchy (`hlod/chain/merge.rs`). Packed in the one cut as its last root
 * (`geometry/hlod/worldHlod.ts`) — one per placement of its model, each at its pose, all sharing the
 * records and the culling hierarchy, each with its own pages —, it is cut by the one rule at the one
 * threshold, as any primitive.
 *
 * What draws a cell is the HLOD switch: an HLOD actor is
 * visible while it is loaded and the cell its sources stream in is not visible. Per HLOD cell and
 * instance, one word says what draws there (`CELL_DRAW`): a visible HLOD 0 cell's placements — its
 * HLOD 0 actor, the source meshes instanced —, or the cell's own actor of the next layer while the
 * cell holding it is visible and the cell itself is not, or nothing of its own. Per cell file a
 * partition placed, one word says whether its main cell is visible: its placements — the source
 * meshes — draw then, whatever their HLOD 0 cell draws (`worldFiles.ts`). The host keeps both
 * (`worldFollow.ts`), switched as a streamed cell's are — shown once wished and loaded, hidden once
 * wished no more, an HLOD cell each after the warm-up of the actors it is about to draw.
 *
 * Behind the cold records: `LINK_HEADER` words (`LINK_HEADER_AT`), then per placement slot its
 * link — its HLOD 0 cell, or the HLOD cell whose instanced actor it is a row of with `ACTOR_ROW`
 * set (`../../hlod/hlodRows.ts`), the instance of the world DAG it lies in and its file's word,
 * `NO_INDEX` for none; a placement of the world DAG itself names its instance alone —, then per
 * world rank its HLOD cell, read by its rank in any instance, then the states, cell after cell for
 * each instance, then a file word per placement slot, then per node of the world's culling
 * hierarchy the HLOD cell whose actor's subtree holds it, `NO_INDEX` for a node over several actors
 * (`nodeCells`). The descent reads them (`../shader/worldGateWgsl.ts`): a placement neither its
 * file nor its HLOD 0 cell draws opens nothing, an actor's row opens while its cell draws that
 * actor, and a node of an actor whose cell does not draw it is not opened.
 *
 * Cost a frame: one word read per placement prepared and per world node tested, and the words that
 * moved written; nothing scans the world.
 */
import {
  CULL_CHILD_COUNT,
  CULL_FIRST_CHILD,
  CULL_FIRST_PAGE,
  CULL_PAGE_COUNT,
  type DagCutLinks,
  type DagRoot,
} from '../types.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { chainChildren } from '../../../../../sdk-core/src/manifest/worldRoots.ts'

/** The children of each cell of a chain, by its parents' table: made once for the follower of the
 *  cut (`worldFollow.ts`) and the partition's HLOD cells (`../../hlod/hlodCells.ts`), which read
 *  one chain. */
const children = new WeakMap<Int32Array, readonly (readonly number[])[]>()

/** Each cell's children in the chain of `parent`s (`chainChildren`): the cells whose actors lie in
 *  it. */
export function cellChildren(parent: Int32Array) {
  let below = children.get(parent)
  if (!below) children.set(parent, (below = chainChildren(parent)))
  return below
}

/** The root mark's bit on each placement of the world DAG (`ClusterRoot.mark`): a ray meets none
 *  of it, and the placement tree opens it from queue 0 (`../placement/placementTreePack.ts`), never through a
 *  group. */
export const WORLD_ROOT_MARK = 16

/** What an HLOD cell's word draws, bit by bit (`worldFollow.ts`): a visible HLOD 0 cell's
 *  placements, and the cell's own actor of the next layer. Zero: nothing of its own. A cell file's
 *  word is `placements` while its main cell is visible, else zero (`worldFiles.ts`). */
export const CELL_DRAW = { placements: 1, hlod: 2 } as const

/** The bit of a placement's cell word (`setLink`) that says it is a row of that cell's actor — an
 *  object standing as itself in it (`../../hlod/hlodRows.ts`) —: it draws while the cell draws its
 *  actor (`CELL_DRAW.hlod`), and its readiness counts in the actor's. A cell's rank stays below
 *  it. */
export const ACTOR_ROW = 0x80000000

/** The header's words, before the links, by rank: the first per-rank cell word, the first state
 *  word, the cell count, the first file word, and the word node `c`'s cell lies at less `c` — node
 *  `c` named by its rank in the cut's node table. */
export const LINK_HEADER_AT = { ranks: 0, states: 1, cells: 2, files: 3, nodes: 4 } as const
/** Words before the links. */
export const LINK_HEADER = 5
/** Words a placement's link takes: its HLOD 0 cell, its instance of the world DAG, its file's
 *  word. */
export const LINK_WORDS = 3

/** The world DAG's placements — one per placement of its model, instance `k` the `k`-th —, each
 *  world rank's HLOD cell, the chain of cells, the links of every placement slot at `linkBase`, the
 *  state words at `stateBase`, `cells` per instance, their host copy `states`, and the file words
 *  at `fileBase`, one per placement slot, their host copy `files`. */
export type PackedWorld = {
  /** The placements of the world DAG, instance by instance: every one shares its records, each its
   *  own pages, pose and residency. */
  roots: readonly number[]
  /** Each world rank's HLOD cell. */
  hlod: Int32Array
  /** How many HLOD cells the chain holds, the HLOD 0 cells first, each layer after the one below. */
  cells: number
  /** Each cell's parent in the chain, -1 for a top cell, its level, and its actor's flags
   *  (`CHAIN_ACTOR`: built, and whether it asks a warm-up; none for an actor not built). */
  parent: Int32Array
  layer: Uint8Array
  actor: Uint8Array
  /** Per HLOD cell, the world ranks nothing replaces that wear a page: what must be resident
   *  before its actor is ready. */
  rootsOf: readonly number[][]
  /** Per HLOD cell, the rows its actor places (`WorldRoots.rows`): each must be covered before
   *  its actor is ready, as a root page must be resident. */
  rowsOf: Uint32Array
  /** `LINK_WORDS` per placement slot (`setLink`). */
  links: Uint32Array
  linkBase: number
  /** The state of cell `h` of instance `k` at `k · cells + h`, and where they lie in the cold
   *  table. */
  states: Uint32Array
  stateBase: number
  /** The word of the file whose slot is `f` at `f` (`worldFiles.ts`), and where they lie. */
  files: Uint32Array
  fileBase: number
}

/** The words the world takes behind the cold records for `worldCount` placement slots, its
 *  `pageCount` ranks and `nodeCount` nodes, `cells` HLOD cells and `instances` placements of its
 *  model. */
export const worldLinkWords = (
  worldCount: number,
  { pageCount, nodeCount }: Pick<DagCutLinks, 'pageCount' | 'nodeCount'>,
  cells: number,
  instances: number,
) => LINK_HEADER + (LINK_WORDS + 1) * worldCount + pageCount + cells * instances + nodeCount

/** Per node of `culling`, the HLOD cell of every rank under it — the cell of the actor whose
 *  subtree holds it (`hlod/chain/merge.rs`) —, `NO_INDEX` for a node over ranks of several cells,
 *  or over none. A node's children lie after it (`page-codec-wasm/src/culling.rs`): one sweep from
 *  the last rolls the cells up. */
function nodeCells({ nodes, stride }: NonNullable<DagRoot['culling']>, cells: Int32Array) {
  const count = nodes.length / stride,
    out = new Uint32Array(count)
  for (let node = count - 1; node >= 0; node--) {
    const at = node * stride,
      children = nodes[at + CULL_CHILD_COUNT],
      first = children ? nodes[at + CULL_FIRST_CHILD] : nodes[at + CULL_FIRST_PAGE],
      size = children || nodes[at + CULL_PAGE_COUNT]
    let cell = size ? (children ? out[first] : cells[first]) : NO_INDEX
    for (let k = 1; k < size && cell !== NO_INDEX; k++)
      if ((children ? out[first + k] : cells[first + k]) !== cell) cell = NO_INDEX
    out[node] = cell
  }
  return out
}

/** Per HLOD cell of `root`'s `cells`, the ranks of its structure nothing replaces that wear a
 *  page: a root no surface wears is no page (`../../hlod/worldRecords.ts`), never resident, and
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
 * included —: the header, no link until a placement says which cell and file it lies in
 * (`GpuSelection.placeInCell`, `worldFollow.ts`) — a placement of the world DAG naming its
 * instance —, each rank's cell, every state and file word drawing nothing until the host walks
 * them, then each node's cell.
 */
export function packWorldLinks(
  roots: readonly DagRoot[],
  worlds: readonly number[],
  slots: number,
  { cutLinks, cold, at }: { cutLinks: readonly DagCutLinks[]; cold: Uint32Array; at: number },
): PackedWorld {
  const root = roots[worlds[0]],
    { cells: hlod, parent, layer, actor, rows: rowsOf } = root.hlod!,
    cells = parent.length,
    { pageCount, nodeBase } = cutLinks[worlds[0]]
  const linkBase = at + LINK_HEADER
  const links = new Uint32Array(LINK_WORDS * Math.max(slots, roots.length)).fill(NO_INDEX)
  worlds.forEach((w, k) => (links[w * LINK_WORDS + 1] = k))
  // Every word is resolved before the first cut (`worldFollow.ts`, `sync`).
  const states = new Uint32Array(cells * worlds.length),
    files = new Uint32Array(slots)
  const hlodBase = linkBase + links.length,
    stateBase = hlodBase + pageCount,
    fileBase = stateBase + states.length,
    nodeCellBase = fileBase + files.length
  cold[at + LINK_HEADER_AT.ranks] = hlodBase
  cold[at + LINK_HEADER_AT.states] = stateBase
  cold[at + LINK_HEADER_AT.cells] = cells
  cold[at + LINK_HEADER_AT.files] = fileBase
  // The cell of node `c` of the cut's node table — the world's from `nodeBase` — at
  // `nodeCellBase + c - nodeBase`: the word wraps as the shader's sum does.
  cold[at + LINK_HEADER_AT.nodes] = (nodeCellBase - nodeBase) >>> 0
  cold.set(links, linkBase)
  cold.set(hlod, hlodBase)
  cold.set(states, stateBase)
  cold.set(files, fileBase)
  cold.set(nodeCells(root.culling!, hlod), nodeCellBase)
  return {
    roots: worlds,
    hlod,
    cells,
    parent,
    layer,
    actor,
    rootsOf: cellRoots(root, cells),
    rowsOf,
    links,
    linkBase,
    states,
    stateBase,
    files,
    fileBase,
  }
}

/** Placement `w` of `world` linked to cell `cell` (`-1` none), refused when that is no cell of the
 *  chain whose placements it may be, `WORLD_CELL_RANGE`: no state follows it. A row of a cell's
 *  actor (`actor`) lies in a cell whose actor places rows, of any layer; any other, in an HLOD 0
 *  cell. */
export function checkLinkCell(world: PackedWorld, w: number, cell: number, actor = false) {
  if (cell < 0) return
  if (cell < world.cells && (actor ? world.rowsOf[cell] > 0 : world.layer[cell] === 0)) return
  const kind = actor ? 'cell placing rows' : 'HLOD 0 cell'
  throw new Error(`WORLD_CELL_RANGE: placement ${w} in cell ${cell}, no ${kind} of the chain`)
}

/** Placement `w` of `world` lies in HLOD 0 cell `cell` of instance `instance` now — or is a row of
 *  that cell's actor (`actor`, `ACTOR_ROW`) —, or none (`-1`), and in the file whose word is at
 *  slot `file`, or none (`NO_INDEX`, `worldFiles.ts`): its words written in `world.links`; whether
 *  they moved. A cell the placement cannot lie in is refused (`checkLinkCell`). An instance the cut
 *  does not pack yet links none: no actor of it is drawn, its placements alone stand for it until
 *  a growth packs it — an actor's row keeps its cell, in no instance, and draws nothing. */
export function setLink(
  world: PackedWorld,
  w: number,
  cell: number,
  instance: number,
  file = NO_INDEX,
  actor = false,
) {
  checkLinkCell(world, w, cell, actor)
  const at = w * LINK_WORDS,
    { links } = world,
    packed = instance < world.roots.length
  const h = cell < 0 ? NO_INDEX : actor ? (cell | ACTOR_ROW) >>> 0 : packed ? cell : NO_INDEX,
    f = packed ? file : NO_INDEX,
    k = packed && (h !== NO_INDEX || f !== NO_INDEX) ? instance : NO_INDEX
  if (links[at] === h && links[at + 1] === k && links[at + 2] === f) return false
  links[at] = h
  links[at + 1] = k
  links[at + 2] = f
  return true
}
