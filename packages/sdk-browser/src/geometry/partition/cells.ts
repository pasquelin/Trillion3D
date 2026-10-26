/**
 * THE CELLS OF A PARTITIONED SCENE, STREAMED BY THEIR GRID'S LOADING RANGE (#404).
 *
 * Before each frame (`frame`), the view is the partition's streaming source (`source.ts`): the
 * plan (`plan.ts`) reads the grids' loading ranges around it — the pages of the cell index within
 * them, the HLOD 0 cells and the cells of no layer wished —, made again once the view moved or
 * turned enough, or while work is left (`streamingUpdate.ts`), the chain of HLOD cells its own
 * (`../hlod/hlodCells.ts`), and the cells wished and not loaded take their turn in one load order,
 * so many loading at once at most, none held back during the initial load (`LoadSlots`). The cell
 * files of each cell loading are asked of the session's page streamer by the priority of its turn,
 * the cell that started first first, as its HLOD cells' holds are; those it holds are decoded
 * off the main thread (`cellDecode.ts`, `decodes.ts`), and those decoded opened or placed within
 * the frame's one integration budget (`FrameBudget`): a page lists its pages or cells to the
 * streamer's catalogue, a cell puts each node on a row of its mesh at the world matrix the engine
 * composes for a child of its core parent, casting as its host mesh says (`placements.ts`,
 * `follow.ts`), each row knowing its HLOD 0 cell (`rowCells.ts`), the track of the scene's
 * animation banks it plays, and — drawn from a streamed core node's own mesh — that node's host
 * mesh as its animation source, shown while it is (`streamed`). Each HLOD cell holds its actor's
 * roots and rows while loaded, and the cut is told what each cell is (`../hlod/hlodCells.ts`). A
 * placed cell whose HLOD 0 cell is neither wished nor visible, or a cell of no layer wished no
 * more, parks its rows; a page past the walk with no cell placed is closed and its files leave the
 * catalogue; a moved parent, a host mesh's `castShadow` changed, or a source mesh shown or hidden,
 * rewrites its rows. A load blocking on slow streaming loads its files alone (`slowStreaming.ts`);
 * the HLOD actors off, no HLOD cell is held and every file streams on the main grid. `prime`,
 * before the first frame, sizes the rows for the placed cells' reach (`sizing.ts`; every node when
 * no owner can reopen the session), then runs the frame to completion (#575). A parent shrunk or
 * stretched unevenly, or the HLOD actors loaded finding a mesh short, grows them in place, else
 * tells the owner (`outgrown`) and the cells past the rows wait.
 *
 * A model placed again in a world (`session/world/models/loadedModel.ts`, `placeModel`) places its cells
 * again through a placement of its partition (`placement`): the same tables, meshes and world
 * roots, its own frame, view, index walk and held cells. The placements share each mesh's rows —
 * sized for the sum of what each one's view asks —, the catalogue — a file leaves it once no
 * placement's index names it — and the world bundles, counted per cell by their holds. Each draws
 * its HLOD cells by its own instance of the world DAG (`pose`), at its own pose.
 */
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createCellBoxes } from './boxes.ts'
import type { CellFrame } from './follow.ts'
import { createCellIndex, type IndexPage, type PageBody } from './cellIndex.ts'
import type { CellRows } from './cellDecode.ts'
import { primeFrames, type CellBudget, type CellFrameIo, type CellPrimeIo } from './cellsPrime.ts'
import { createDecodes, takeDecoded } from './decodes.ts'
import { createCellPlan } from './plan.ts'
import { createCellView } from './cellView.ts'
import { createCoarserPulls } from './coarser.ts'
import { createHlodPulls } from '../hlod/hlodPulls.ts'
import { createLoadSlots } from './loadSlots.ts'
import { createStreamingSource } from './source.ts'
import { createFramePlanning } from './framePlanning.ts'
import {
  activatesCells,
  resolveWorldStreaming,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { capacityOf, type PlacedMesh, type StreamedMeshes } from './rows.ts'
import { createRowSizing } from './sizing.ts'
import { createCellPlacements } from './placements.ts'
import { createCellHolds } from './cellHolds.ts'
import { createHlodCells } from '../hlod/hlodCells.ts'
import { createActorRows } from '../hlod/hlodRows.ts'
import type { WorldRootsHold } from '../hlod/worldRoots.ts'
import type { WorldCells } from '../dag/worlds/worldCells.ts'
import { createSlowStreaming } from './slowStreaming.ts'
import type { PlacementRows } from '../../placement/rows/rows.ts'
import { sharedCatalogue, type PartitionShare } from './cellShare.ts'

type Inputs = {
  partition: TablePartition
  /** The folder the tables were read from. */ base: string
  /** The prepared scene's root: where the tables hang a cell node. */ root: Object3D
  /** The host node of each core rank. */ parents: readonly Object3D[]
  /** The placed mesh of each mesh rank the cells place. */ meshes: ReadonlyMap<number, PlacedMesh>
  /** The host meshes each streamed core node draws, by primitive: what a row a cell draws from
   *  that node's own mesh reads (`CellNode.source`). */
  streamed?: StreamedMeshes
  /** The world bundles its HLOD cells' roots lie in. */
  world?: Pick<WorldRootsHold, 'hold' | 'release'> &
    Partial<Pick<WorldRootsHold, 'table' | 'bytesOf'>>
}

/** How the view streams the cells and takes their turns: the session's settings as they stand at
 *  the frame (`CellFrameIo.streaming`) — every default till one says otherwise —, the view as the
 *  source, the load slots, and per grid the coarser cells its wished ones pull in, if it asks it;
 *  the chain's so pulled. */
function streamingParts(partition: TablePartition, world: Inputs['world']) {
  const streaming = resolveWorldStreaming()
  const source = createStreamingSource(streaming, partition),
    slots = createLoadSlots(streaming, partition.scheme)
  const grids = partition.hlod.grids
  const pulls = createCoarserPulls(partition.hlod),
    pulled = createHlodPulls(world?.table?.chain, grids, pulls, source)
  return { streaming, source, slots, grids, pulls, pulled }
}

/** What a partition's cells keep: the index, the plan, the rows, the HLOD cells and what the last
 *  frame left. */
interface CellsState extends ReturnType<typeof streamingParts> {
  inputs: Inputs
  share: PartitionShare
  /** The placement of its model this one is (`pose`): its instance of the world DAG. */
  instance: number
  index: ReturnType<typeof createCellIndex>
  decodes: ReturnType<typeof createDecodes<number, CellRows>>
  pageDecodes: ReturnType<typeof createDecodes<IndexPage, PageBody>>
  holds: ReturnType<typeof createCellHolds>
  frame: CellFrame
  rows: ReturnType<typeof createCellPlacements>
  actors: ReturnType<typeof createActorRows>
  hlod: ReturnType<typeof createHlodCells>
  plan: ReturnType<typeof createCellPlan>
  /** Whether a load blocks on slow streaming (`slowStreaming.ts`): a file shows as its main cell —
   *  placed, without a world DAG — or is refused for good. */
  slow: ReturnType<typeof createSlowStreaming>
  /** The cut's world cells the last frame told. */
  cells: WorldCells | undefined
  /** Cells waiting for rows. */
  waiting: number
  /** Where the camera stands in the cells' frame, and the rung its view asks. */
  view: ReturnType<typeof createCellView>
  /** The rows this placement asks of the meshes, its view's and its actors' (`sizing.ts`). */
  sizing: ReturnType<typeof createRowSizing>
  /** The frame's io, its catalogue held through `share` — made once per io given — and budget. */
  given: CellFrameIo | undefined
  at: { io: CellFrameIo; catalogue: ReturnType<typeof sharedCatalogue>; budget: CellBudget }
  /** What a frame does with the cells its view wishes (`framePlanning.ts`). */
  planning: ReturnType<typeof createFramePlanning>
  /** The identity this placement holds in what the placements share. */
  self: object
  /** What the frame asks of the pages and files it takes, made once. */
  takes: {
    pageUrl: (page: IndexPage) => string
    open: (page: IndexPage, body: PageBody) => boolean
    decodePage: (bytes: Uint8Array, url: string) => Promise<PageBody>
    url: (cell: number) => string
    decode: (bytes: Uint8Array, url: string) => Promise<CellRows>
    place: (cell: number, decoded: CellRows) => boolean
    readBy: (cell: number) => number
  }
  /** The cells the last plan wished and not loaded, and the files a blocking load waits for. */
  planned: ReturnType<ReturnType<typeof createFramePlanning>['run']>
  waits: ReadonlySet<number>
}

const cellUrl = (s: CellsState, cell: number) => s.index.cell(cell).url

/** What the frame asks of the pages and files it takes, made once. */
const takesOf = (s: CellsState): CellsState['takes'] => ({
  pageUrl: (page) => page.slot.url,
  open: (page, body) => {
    s.at.catalogue.admit(s.index.open(page, body))
    return true
  },
  decodePage: (bytes, url) => s.at.io.decodePage(bytes, url),
  url: (cell) => cellUrl(s, cell),
  decode: (bytes, url) => s.at.io.decode(bytes, url),
  place: (cell, decoded) => placeCell(s, cell, decoded),
  readBy: (cell) => s.plan.priority(cell) ?? s.slots.priorityOf(),
})

/** The state of a partition's cells: its index, its streaming, its rows and its HLOD cells. */
function createState(inputs: Inputs, share: PartitionShare, self: object): CellsState {
  const { partition, base, root, parents, meshes, streamed, world } = inputs
  const boxes = createCellBoxes(partition.parents, root, parents)
  const index = createCellIndex(partition.pages, base, boxes)
  const streams = streamingParts(partition, world)
  const { streaming, source, slots, grids, pulls, pulled } = streams
  const holds = createCellHolds(world)
  const frame: CellFrame = {}
  const rows = createCellPlacements(root, parents, meshes, frame, () => s.instance, streamed)
  /** The rows each HLOD cell's instanced actor places while loaded (`../hlod/hlodRows.ts`). */
  const actors = createActorRows(world, rows)
  const hlod = createHlodCells(world, holds, grids, source, slots, pulled, actors)
  const plan = createCellPlan(index, source, pulls, pulled)
  const at = {
    io: undefined as unknown as CellFrameIo,
    catalogue: undefined as unknown as ReturnType<typeof sharedCatalogue>,
    budget: undefined as unknown as CellBudget,
  }
  const failed = (url: string) => at.io.failed(url)
  const s: CellsState = {
    ...streams,
    inputs,
    share,
    instance: 0,
    index,
    decodes: createDecodes<number, CellRows>(),
    pageDecodes: createDecodes<IndexPage, PageBody>(),
    holds,
    frame,
    rows,
    actors,
    hlod,
    plan,
    slow: createSlowStreaming(streaming, partition.scheme, grids, source, {
      shown: (cell) =>
        failed(cellUrl(s, cell)) ||
        (s.cells ? s.cells.fileShown(s.instance, cell) : rows.held.has(cell)),
      mainOf: (cell) => index.cell(cell).main,
    }),
    cells: undefined,
    waiting: 0,
    view: createCellView(root, frame, boxes, partition, source, pulls),
    sizing: createRowSizing(partition, meshes, [share, self], actors),
    given: undefined,
    at,
    self,
    takes: undefined as unknown as CellsState['takes'],
    planned: undefined as unknown as CellsState['planned'],
    waits: new Set<number>(),
    planning: createFramePlanning({
      ...{ streaming, scheme: partition.scheme, source, plan, pulled, hlod, rows, held: rows.held },
      ...{ grids, failed },
    }),
  }
  s.takes = takesOf(s)
  return s
}

/** Places `cell`, its rows knowing its HLOD 0 cell — -1 for objects in no layer —; a mesh short
 *  of rows keeps it waiting. */
const placeCell = (s: CellsState, cell: number, decoded: CellRows) =>
  s.rows.place(cell, decoded, cellUrl(s, cell), s.index.cell(cell).hlod?.[0] ?? -1) ||
  (s.waiting++, false)

/** The frame's io, settings and view taken, and the cells its view wishes planned and told to take
 *  their turn. */
function planFrame(
  s: CellsState,
  eye: ArrayLike<number>,
  io: CellFrameIo,
  budget: CellBudget,
  axis?: ArrayLike<number>,
  up?: ArrayLike<number>,
) {
  const { at, frame, streaming, planning, slow, slots, hlod } = s
  if (io !== s.given) at.catalogue = sharedCatalogue((s.given = io), s.share, s.self)
  at.io = io
  at.budget = budget
  frame.compose = io.compose
  // Read once: the host resolves its settings at each read.
  const settings = io.streaming
  if (settings) Object.assign(streaming, settings)
  // A scene with no world DAG parks its rows while the view only loads; a world's words hide the rest.
  frame.hidden = !activatesCells(streaming) && !io.world
  s.rows.follow()
  const local = s.view(eye, axis, up, io.time)
  s.sizing.frame(local.rung, io)
  // The ranges are read in the cells' frame, the world DAG's at this placement's pose.
  s.cells = io.world
  const planned = planning.run(local, eye, axis, s.cells, s.instance, !!io.initialLoad)
  const { hlodOn } = planning
  const waits = slow.weigh(planning.stood, planning.activated(planned.main), !!io.initialLoad)
  s.cells?.blockingLoad(s.instance, waits)
  // The cells wished and not loaded take their turn: so many load at once at most, none held
  // back during the initial load nor while a load blocks.
  if (hlodOn) hlod.waiting(planned.waiting, planned.ranker)
  slots.admit(planned.waiting, !!io.initialLoad || waits.size > 0)
  if (hlodOn) hlod.start()
  s.planned = planned
  s.waits = waits
}

/** The pages and files the plan lists, read and opened or placed within the frame's budget; true
 *  when a page or cell is left for a later frame. */
function takeFrame(s: CellsState) {
  const { at, planning, slots, planned, waits, takes } = s
  const held = s.rows.held
  at.catalogue.forget(s.index.forgotten())
  s.waiting = 0
  let later = takeDecoded(
    planned.pages,
    at,
    s.pageDecodes,
    takes.pageUrl,
    takes.decodePage,
    takes.open,
  )
  // A page opened now brings its cells to the next frame's plan.
  later ||= planned.pages.some((page) => page.body)
  // The files a blocking load waits for load at once, with those of each unit loading.
  const files = s.plan.files(slots, held)
  for (const cell of waits) if (!held.has(cell) && !files.includes(cell)) files.push(cell)
  later =
    takeDecoded(files, at, s.decodes, takes.url, takes.decode, takes.place, takes.readBy) || later
  // A cell wished and left without a slot loads at a later frame, a still view's too.
  later ||= slots.queued()
  // A placed file kept by its HLOD 0 cell's visibility alone is work once that cell is hidden.
  const released = planned.holds.some((leaf) => !s.hlod.visible(leaf))
  planning.end(later || planned.waiting.length > 0 || released || waits.size > 0)
  // What the plan no longer lists is dropped; its reads were let go by the one asker.
  s.pageDecodes.end()
  s.decodes.end()
  s.rows.touched.flush(at.io.update)
  return later
}

/** The partition is let go: see `PartitionCells.close`. */
function closeCells(
  s: CellsState,
  io: { update(rows: PlacementRows, from: number, to: number): void },
) {
  const { slow, slots, rows } = s
  s.hlod.close(s.cells, s.instance)
  s.planning.reset()
  slow.clear()
  s.cells?.blockingLoad(s.instance, slow.waits)
  slots.clear()
  for (const cell of rows.held.keys()) rows.leave(cell)
  s.sizing.clear()
  s.pageDecodes.clear()
  s.decodes.clear()
  rows.touched.flush(io.update)
}

/** The frame, the prime and the close of a partition's cells. */
function cellsFlow(s: CellsState) {
  const frame = (
    eye: ArrayLike<number>,
    io: CellFrameIo,
    budget: CellBudget,
    axis?: ArrayLike<number>,
    up?: ArrayLike<number>,
  ) => {
    planFrame(s, eye, io, budget, axis, up)
    return takeFrame(s)
  }
  return {
    /** Before a frame from `eye` looking along the unit `axis`, `up` above it: the plan's cells
     *  leave and far pages close, rows past those sized grow, the cells wished and not loaded take
     *  their turn, the pages and the files of the cells loading are asked, those read handed to the
     *  page worker pool, those decoded opened or placed while the frame's `budget` admits them, and
     *  the HLOD cells hold their roots and tell the cut what they are. True when a page or cell it
     *  wants is left for a later frame. */
    frame,
    /** Before the engines read the rows: sizes them for the placed cells' reach around `eye` or
     *  the widest a frame asked (every node unless `owned`), then runs `frame` to completion
     *  (`primeFrames`); the bytes read. */
    async prime(eye: ArrayLike<number>, io: CellPrimeIo, owned: boolean) {
      s.sizing.prime(s.view(eye).rung, owned)
      const bytes: number = await primeFrames(eye, io, frame, () => decodesAsked(s))
      s.rows.touched.clear()
      return bytes
    },
    /** The partition is let go — the world left the scene it hung from —: every cell placed gives
     *  its rows back, parked, every HLOD cell its roots and what it was told, its decodes are
     *  dropped (its reads, no longer asked, are let go by the asker); `update` is told the rows
     *  written. The cells place again at the next `frame`, were it followed anew. */
    close: (io: { update(rows: PlacementRows, from: number, to: number): void }) =>
      closeCells(s, io),
  }
}

/** The decodes asked since the last call: a still camera is drawn again once one lands. */
const decodesAsked = (s: CellsState) => [...s.pageDecodes.asked(), ...s.decodes.asked()]

export function createPartitionCells(
  inputs: Inputs,
  share: PartitionShare = { needs: new Map(), admitted: new Map() },
) {
  const { world, meshes } = inputs
  const s = createState(inputs, share, {})
  const { frame, rows, index } = s
  const partitionCells = {
    /** The scene hangs in the world `world()` gives, its model's, the placement `placed` of it
     *  (`placementIndex`): the rows are that world times their own, the camera is read in the
     *  scene's frame through it, and the rows draw the objects of that instance of the world
     *  DAG. */
    pose(world: () => Float64Array, placed = 0) {
      frame.world = world
      s.instance = placed
    },
    /** The world roots its HLOD cells are drawn from: the cut's world cells serve those of the
     *  world DAG it packs, whose instance at this placement's pose draws them. */
    world: world as object | undefined,
    /** Another placement of the same partition, for a model placed again (`placeModel`): its own
     *  frame and instance (`pose`), view, index and cells, sharing this one's meshes, catalogue
     *  and world roots. */
    placement() {
      return createPartitionCells(inputs, share)
    },
    /** The files the streamer's catalogue holds at a session's open: every one the index names now
     *  (`cellIndex.ts`, `named`). */
    get pages() {
      return index.named()
    },
    /** The source nodes the cells placed now draw as themselves: what the physics makes a body or a
     *  collider with and lets go of with (`cellDraws.ts`). */
    draws: rows.draws,
    /** The pages of the index opened and the cells they list, the cells placed now, those a mesh
     *  short of rows keeps waiting, and the rows sized. */
    stats: () => ({
      ...index.stats(),
      held: rows.held.size,
      waiting: s.waiting,
      rows: [...meshes.values()].reduce((sum, mesh) => sum + capacityOf(mesh), 0),
    }),
    /** Whether its load blocks on slow streaming, as the last frame weighed it: the images are
     *  withheld meanwhile (`Engine.streamingBlocks`). */
    get blocking() {
      return s.slow.waits.size > 0
    },
    /** What a frame waits on: the next HLOD hold to land or fail, while one reads. */
    reads: s.holds.reads,
    /** The decodes asked since the last call: a still camera is drawn again once one lands. */
    decodes: () => decodesAsked(s),
  }
  return Object.assign(partitionCells, cellsFlow(s))
}

export type PartitionCells = ReturnType<typeof createPartitionCells>
