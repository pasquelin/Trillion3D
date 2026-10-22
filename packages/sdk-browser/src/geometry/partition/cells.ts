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
import { resolveCameraWorld } from '../../camera/world.ts'
import { createCellBoxes } from './boxes.ts'
import type { CellFrame } from './follow.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { createCellIndex, type IndexPage, type PageBody } from './cellIndex.ts'
import type { CellRows } from './cellDecode.ts'
import { primeFrames, type CellBudget, type CellFrameIo, type CellPrimeIo } from './cellsPrime.ts'
import { createDecodes, takeDecoded } from './decodes.ts'
import { createCellPlan } from './plan.ts'
import { inCellFrame, placedReach } from './reach.ts'
import { createCoarserPulls } from './coarser.ts'
import { createHlodPulls } from '../hlod/hlodPulls.ts'
import { createLoadSlots } from './loadSlots.ts'
import { createStreamingSource } from './source.ts'
import { createStreamingUpdate } from './streamingUpdate.ts'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { capacityOf, type PlacedMesh, type StreamedMeshes } from './rows.ts'
import { createRowSizing, heldSide, rungOf } from './sizing.ts'
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

export function createPartitionCells(
  inputs: Inputs,
  share: PartitionShare = { needs: new Map(), admitted: new Map() },
) {
  const { partition, base, root, parents, meshes, streamed, world } = inputs
  const self = {}
  /** The placement of its model this one is (`pose`): its instance of the world DAG. */
  let instance = 0
  const boxes = createCellBoxes(partition.parents, root, parents)
  const index = createCellIndex(partition.pages, base, boxes)
  const decodes = createDecodes<number, CellRows>(),
    pageDecodes = createDecodes<IndexPage, PageBody>()
  const grids = partition.hlod.grids
  /** How the view streams the cells, as the session's settings stand at the frame
   *  (`CellFrameIo.streaming`): every default till one says otherwise. */
  const streaming = resolveWorldStreaming()
  const source = createStreamingSource(streaming, partition),
    slots = createLoadSlots(streaming, partition.scheme)
  /** Per grid, the coarser cells its wished ones pull in, if it asks it; the chain's so pulled. */
  const pulls = createCoarserPulls(partition.hlod),
    pulled = createHlodPulls(world?.table?.chain, grids, pulls, source)
  const holds = createCellHolds(world)
  const frame: CellFrame = {}
  const rows = createCellPlacements(root, parents, meshes, frame, () => instance, streamed)
  const { held, touched } = rows
  /** The rows each HLOD cell's instanced actor places while loaded (`../hlod/hlodRows.ts`). */
  const actors = createActorRows(world, rows)
  const hlod = createHlodCells(world, holds, grids, source, slots, pulled, actors)
  const plan = createCellPlan(index, source, pulls, pulled)
  const update = createStreamingUpdate(streaming, partition.scheme)
  /** The priority a cell file reads by: its unit's, else — a blocking load's — after every cell
   *  loading (`LoadSlots.priorityOf`). */
  const readBy = (cell: number) => plan.priority(cell) ?? slots.priorityOf()
  /** Whether a load blocks on slow streaming (`slowStreaming.ts`): a file shows as its main cell —
   *  placed, without a world DAG — or is refused for good. */
  const slow = createSlowStreaming(streaming, partition.scheme, grids, source, {
    shown: (cell) =>
      failed(cellUrl(cell)) || (cells ? cells.fileShown(instance, cell) : held.has(cell)),
    mainOf: (cell) => index.cell(cell).main,
  })
  /** The cut's world cells the last frame told, whether the HLOD actors were on, and the eye the
   *  last plan was made from. */
  let cells: WorldCells | undefined,
    hlodOn = true,
    stood: ArrayLike<number> = [0, 0, 0]
  /** Cells waiting for rows. */
  let waiting = 0
  /** Where the camera at `eye` stands in the cells' frame, and the rung its view asks. */
  const framed = new Float64Array(MATRIX_VALUES)
  /** The scene root's world, in the frame it hangs in (`pose`). */
  const rootWorld = () => {
    const world = resolveCameraWorld(root).worldMatrix,
      outer = frame.world?.()
    return outer ? multiplyMatrix4(framed, outer, world) : world
  }
  const view = (eye: ArrayLike<number>, axis?: ArrayLike<number>) => {
    const world = rootWorld()
    const local = inCellFrame(world, eye, placedReach(grids, source, pulls), axis)
    boxes.refresh()
    const rung = rungOf(heldSide(local.reach, partition.cube, boxes.stretch), partition.cube)
    return { ...local, rung, world }
  }
  /** The rows this placement asks of the meshes, its view's and its actors' (`sizing.ts`). */
  const sizing = createRowSizing(partition, meshes, [share, self], actors)
  const cellUrl = (cell: number) => index.cell(cell).url
  /** The frame's io, its catalogue held through `share` — made once per io given — and budget. */
  let given: CellFrameIo | undefined
  const at = {
    io: undefined as unknown as CellFrameIo,
    catalogue: undefined as unknown as ReturnType<typeof sharedCatalogue>,
    budget: undefined as unknown as CellBudget,
  }
  const pageUrl = (page: IndexPage) => page.slot.url
  const failed = (url: string) => at.io.failed(url)
  const open = (page: IndexPage, body: PageBody) => {
    at.catalogue.admit(index.open(page, body))
    return true
  }
  const decodePage = (bytes: Uint8Array, url: string) => at.io.decodePage(bytes, url)
  const decode = (bytes: Uint8Array, url: string) => at.io.decode(bytes, url)
  /** Places `cell`, its rows knowing its HLOD 0 cell — -1 for objects in no layer —; a mesh short
   *  of rows keeps it waiting. */
  const place = (cell: number, decoded: CellRows) =>
    rows.place(cell, decoded, cellUrl(cell), index.cell(cell).hlod?.[0] ?? -1) || (waiting++, false)
  const partitionCells = {
    /** The scene hangs in the world `world()` gives, its model's, the placement `placed` of it
     *  (`placementIndex`): the rows are that world times their own, the camera is read in the
     *  scene's frame through it, and the rows draw the objects of that instance of the world
     *  DAG. */
    pose(world: () => Float64Array, placed = 0) {
      frame.world = world
      instance = placed
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
    /** The pages of the index opened and the cells they list, the cells placed now, those a mesh
     *  short of rows keeps waiting, and the rows sized. */
    stats: () => ({
      ...index.stats(),
      held: held.size,
      waiting,
      rows: [...meshes.values()].reduce((sum, mesh) => sum + capacityOf(mesh), 0),
    }),
    /** Before a frame from `eye` looking along the unit `axis`: the plan's cells leave and far
     *  pages close, rows past those sized grow, the cells wished and not loaded take their turn,
     *  the pages and the files of the cells loading are asked, those read handed to the page worker
     *  pool, those decoded opened or placed while the frame's `budget` admits them, and the HLOD
     *  cells hold their roots and tell the cut what they are. True when a page or cell it wants is
     *  left for a later frame. */
    frame(eye: ArrayLike<number>, io: CellFrameIo, budget: CellBudget, axis?: ArrayLike<number>) {
      if (io !== given) at.catalogue = sharedCatalogue((given = io), share, self)
      at.io = io
      at.budget = budget
      frame.compose = io.compose
      // Read once: the host resolves its settings at each read.
      const settings = io.streaming
      if (settings) Object.assign(streaming, settings)
      rows.follow()
      const local = view(eye, axis)
      sizing.frame(local.rung, io)
      // The ranges are read in the cells' frame, the world DAG's at this placement's pose.
      cells = io.world
      // The wishes are planned again once the view moved or turned enough, in the camera's world.
      const again = update.due(eye, axis, local.world, !!io.initialLoad, boxes.stretch)
      if (again) source.set((stood = local.eye), local.axis)
      pulled.update()
      // The HLOD actors off, no HLOD cell is held nor told, every file streams on the main grid.
      if (hlodOn && !streaming.hlod) hlod.close(cells, instance)
      hlodOn = streaming.hlod
      cells?.hlodEnabled(hlodOn)
      cells?.activated(streaming.targetState === 'activated')
      const leaves = hlodOn && cells ? hlod : undefined
      const planned = again ? plan.plan(stood, grids, held, failed, leaves, hlodOn) : plan.replay()
      for (const cell of planned.leave) rows.leave(cell)
      // A placed cell whose main grid cell is wished draws its source meshes, one past it its HLOD
      // 0 actor: the same rows, told apart in the HLOD view (`proxy`).
      if (again) for (const cell of held.keys()) rows.proxy(cell, !planned.main.has(cell))
      if (hlodOn) hlod.follow(planned.leaves, stood, cells, instance)
      // A cell loaded and not activated holds no image back.
      const main = streaming.targetState === 'loaded' ? new Map() : planned.main
      const waits = slow.weigh(stood, main, !!io.initialLoad)
      cells?.blockingLoad(instance, waits)
      // The cells wished and not loaded take their turn: so many load at once at most, none held
      // back during the initial load; while a load blocks, those loading go on and none starts.
      if (hlodOn) hlod.waiting(planned.waiting, planned.ranker)
      const turns = waits.size ? planned.waiting.filter(({ key }) => slots.loads(key)) : null
      slots.admit(turns ?? planned.waiting, !!io.initialLoad)
      if (hlodOn) hlod.start()
      at.catalogue.forget(index.forgotten())
      waiting = 0
      let later = takeDecoded(planned.pages, at, pageDecodes, pageUrl, decodePage, open)
      // A page opened now brings its cells to the next frame's plan.
      later ||= planned.pages.some((page) => page.body)
      // The files a blocking load waits for load at once, with those of each unit loading.
      const files = plan.files(slots, held)
      for (const cell of waits) if (!held.has(cell) && !files.includes(cell)) files.push(cell)
      later = takeDecoded(files, at, decodes, cellUrl, decode, place, readBy) || later
      // A cell wished and left without a slot loads at a later frame, a still view's too.
      later ||= slots.queued()
      update.end(later || planned.waiting.length > 0 || planned.holding > 0 || waits.size > 0)
      // What the plan no longer lists is dropped; its reads were let go by the one asker.
      pageDecodes.end()
      decodes.end()
      touched.flush(at.io.update)
      return later
    },
    /** Before the engines read the rows: sizes them for the placed cells' reach around `eye` or
     *  the widest a frame asked (every node unless `owned`), then runs `frame` to completion
     *  (`primeFrames`); the bytes read. */
    async prime(eye: ArrayLike<number>, io: CellPrimeIo, owned: boolean) {
      sizing.prime(view(eye).rung, owned)
      const bytes: number = await primeFrames(eye, io, partitionCells.frame, partitionCells.decodes)
      touched.clear()
      return bytes
    },
    /** The partition is let go — the world left the scene it hung from —: every cell placed gives
     *  its rows back, parked, every HLOD cell its roots and what it was told, its decodes are
     *  dropped (its reads, no longer asked, are let go by the asker); `update` is told the rows
     *  written. The cells place again at the next `frame`, were it followed anew. */
    close(io: { update(rows: PlacementRows, from: number, to: number): void }) {
      hlod.close(cells, instance)
      update.reset()
      slow.clear()
      cells?.blockingLoad(instance, slow.waits)
      slots.clear()
      for (const cell of held.keys()) rows.leave(cell)
      sizing.clear()
      pageDecodes.clear()
      decodes.clear()
      touched.flush(io.update)
    },
    /** Whether its load blocks on slow streaming, as the last frame weighed it: the images are
     *  withheld meanwhile (`Engine.streamingBlocks`). */
    get blocking() {
      return slow.waits.size > 0
    },
    /** What a frame waits on: the next HLOD hold to land or fail, while one reads. */
    reads: holds.reads,
    /** The decodes asked since the last call: a still camera is drawn again once one lands. */
    decodes: () => [...pageDecodes.asked(), ...decodes.asked()],
  }
  return partitionCells
}

export type PartitionCells = ReturnType<typeof createPartitionCells>
