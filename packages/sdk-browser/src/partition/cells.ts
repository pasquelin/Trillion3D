/**
 * THE CELLS OF A PARTITIONED SCENE, STREAMED BY THEIR GRID'S LOADING RANGE (#404).
 *
 * Before each frame (`frame`), the plan (`plan.ts`) reads the grids' loading ranges around the
 * camera: the pages of the cell index within them and the cells whose HLOD 0 cell wants its
 * placements are asked of the session's page streamer, nearest first; those it holds are decoded
 * off the main thread (`cellDecode.ts`, `decodes.ts`), and those decoded opened or placed within
 * the frame's one integration budget (`FrameBudget`): a page lists its pages or cells to the
 * streamer's catalogue, a cell puts each node on a row of its mesh at the world matrix the engine
 * composes for a child of its core parent, casting as its host mesh says (`placements.ts`,
 * `follow.ts`), each row knowing its HLOD 0 cell (`rowCells.ts`). Each HLOD cell holds its actor's
 * roots while it is loaded, and the cut is told what each cell is (`hlodCells.ts`). A placed cell
 * whose HLOD 0 cell is neither wished nor visible parks its rows; a page
 * past the walk with no cell placed is closed and its files leave the catalogue; a moved parent, or
 * a host mesh's `castShadow` changed, rewrites its rows. `prime`, before the first frame, sizes the
 * rows for the placed cells' reach (`sizing.ts`; every node when no owner can reopen the session),
 * then runs the frame to completion (#575). A parent shrunk or stretched unevenly grows them in
 * place, else tells the owner (`outgrown`) and the cells past the rows wait.
 *
 * A model placed again in a world (`world/core/loadedModel.ts`, `placeModel`) places its cells
 * again through a placement of its partition (`placement`): the same tables, meshes and world
 * roots, its own frame, view, index walk and held cells. The placements share each mesh's rows —
 * sized for the sum of what each one's view asks —, the catalogue — a file leaves it once no
 * placement's index names it — and the world bundles, counted per cell by their holds. Each draws
 * its HLOD cells by its own instance of the world DAG (`pose`), at its own pose.
 */
import { RUNGS, type TablePartition } from '../../../sdk-core/src/scene/core/tablePartition.ts'
import type { PlacementGrowth } from '../placement/engineSceneUpdates.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import { createCellBoxes } from './boxes.ts'
import type { CellFrame } from './follow.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { createCellIndex, type IndexPage, type PageBody } from './cellIndex.ts'
import type { CellRows } from './cellDecode.ts'
import { primeFrames, type CellBudget, type CellFrameIo, type CellPrimeIo } from './cellsPrime.ts'
import { createDecodes, takeDecoded } from './decodes.ts'
import { createCellPlan, inCellFrame, placedReach } from './plan.ts'
import { capacityOf, sizeRows, type PlacedMesh } from './rows.ts'
import { heldSide, rowsAt, rungOf } from './sizing.ts'
import { createCellPlacements } from './placements.ts'
import { createCellHolds } from './cellHolds.ts'
import { createHlodCells } from './hlodCells.ts'
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import type { WorldCells } from '../gpu/core/selection.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import type { PlacementRows } from '../placement/rows.ts'

type Inputs = {
  partition: TablePartition
  /** The folder the tables were read from. */ base: string
  /** The prepared scene's root: where the tables hang a cell node. */ root: Object3D
  /** The host node of each core rank. */ parents: readonly Object3D[]
  /** The placed mesh of each mesh rank the cells place. */ meshes: ReadonlyMap<number, PlacedMesh>
  /** The world bundles its HLOD cells' roots lie in. */
  world?: Pick<WorldRootsHold, 'hold' | 'release' | 'lift'> & Partial<Pick<WorldRootsHold, 'table'>>
}

/** What the placements of one partition share: the rows each one's view asks of every mesh, and
 *  the placements whose index names each file it admitted. */
type PartitionShare = {
  needs: Map<object, ReadonlyMap<number, number>>
  admitted: Map<string, Set<object>>
}

/** The rows of each mesh every placement's view asks together. */
function summedNeeds(needs: PartitionShare['needs']) {
  const sum = new Map<number, number>()
  for (const asked of needs.values())
    for (const [mesh, rows] of asked) sum.set(mesh, (sum.get(mesh) ?? 0) + rows)
  return sum
}

/** `io`'s catalogue as placement `self` holds it in `share`: a file is admitted by the first
 *  placement that names it and forgotten once the last one lets it go; one no placement admitted
 *  — the session catalogued it at open — is forgotten as before. */
function sharedCatalogue(
  io: Pick<CellFrameIo, 'admit' | 'forget'>,
  share: PartitionShare,
  self: object,
): Pick<CellFrameIo, 'admit' | 'forget'> {
  return {
    admit(pages) {
      const fresh = pages.filter((page) => {
        const holders = share.admitted.get(page.url)
        if (holders) return (void holders.add(self), false)
        share.admitted.set(page.url, new Set([self]))
        return true
      })
      if (fresh.length) io.admit(fresh)
    },
    forget(urls) {
      const gone = urls.filter((url) => {
        const holders = share.admitted.get(url)
        if (!holders) return true
        holders.delete(self)
        if (holders.size) return false
        share.admitted.delete(url)
        return true
      })
      if (gone.length) io.forget(gone)
    },
  }
}

export function createPartitionCells(
  inputs: Inputs,
  share: PartitionShare = { needs: new Map(), admitted: new Map() },
) {
  const { partition, base, root, parents, meshes, world } = inputs
  const self = {}
  /** The placement of its model this one is (`pose`): its instance of the world DAG. */
  let instance = 0
  const boxes = createCellBoxes(partition.parents, root, parents)
  const index = createCellIndex(partition.pages, base, boxes)
  const decodes = createDecodes<number, CellRows>(),
    pageDecodes = createDecodes<IndexPage, PageBody>()
  const ranges = partition.hlod.ranges
  const holds = createCellHolds(world)
  const frame: CellFrame = {}
  const rows = createCellPlacements(root, parents, meshes, frame, () => instance)
  const { held, touched } = rows
  const hlod = createHlodCells(world, holds, ranges)
  const plan = createCellPlan(index)
  /** The cut's world cells the last frame told. */
  let cells: WorldCells | undefined
  /** Cells waiting for rows; the rung the rows are sized for (`RUNGS`: all); the widest asked. */
  let waiting = 0,
    sized = -1,
    wanted = -1
  /** Where the camera at `eye` stands in the cells' frame, and the rung its view asks. */
  const framed = new Float64Array(MATRIX_VALUES)
  /** The scene root's world, in the frame it hangs in (`pose`). */
  const rootWorld = () => {
    const world = resolveCameraWorld(root).worldMatrix,
      outer = frame.world?.()
    return outer ? multiplyMatrix4(framed, outer, world) : world
  }
  const view = (eye: ArrayLike<number>, axis?: ArrayLike<number>) => {
    const local = inCellFrame(rootWorld(), eye, placedReach(ranges), axis)
    boxes.refresh()
    const rung = rungOf(heldSide(local.reach, partition.cube, boxes.stretch), partition.cube)
    return { ...local, rung }
  }
  /** Sizes the rows for `rung`, in place under `grow`; false, unsized, if refused. */
  const resize = (rung: number, grow?: PlacementGrowth) => {
    const before = share.needs.get(self)
    share.needs.set(self, rowsAt(partition, rung))
    if (!sizeRows(meshes, summedNeeds(share.needs), grow)) {
      if (before) share.needs.set(self, before)
      else share.needs.delete(self)
      return false
    }
    // Rows that hold every node for every placement hold any view: no wider rung asks for more.
    const placements = share.needs.size
    const every = [...partition.totals].every(([mesh, total]) => {
      const placed = meshes.get(mesh)
      return !placed || capacityOf(placed) >= total * placements
    })
    sized = every ? RUNGS : Math.max(sized, rung)
    return true
  }
  const cellUrl = (cell: number) => index.cell(cell).url
  /** The frame's io, its catalogue held through `share` — made once per io given — and budget. */
  let given: CellFrameIo | undefined
  const at = {
    io: undefined as unknown as CellFrameIo,
    catalogue: undefined as unknown as ReturnType<typeof sharedCatalogue>,
    budget: undefined as unknown as CellBudget,
  }
  const pageUrl = (page: IndexPage) => page.slot.url
  const pageFailed = (page: IndexPage) => at.io.failed(page.slot.url)
  const open = (page: IndexPage, body: PageBody) => {
    at.catalogue.admit(index.open(page, body))
    return true
  }
  const decodePage = (bytes: Uint8Array, url: string) => at.io.decodePage(bytes, url)
  const decode = (bytes: Uint8Array, url: string) => at.io.decode(bytes, url)
  /** Places `cell`, its rows knowing its HLOD 0 cell; a mesh short of rows keeps it waiting. */
  const place = (cell: number, decoded: CellRows) =>
    rows.place(cell, decoded, cellUrl(cell), index.cell(cell).hlod[0]) || (waiting++, false)
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
    /** The grids' loading ranges: the main grid's, then each HLOD layer's. */
    ranges,
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
     *  pages close, rows past those sized grow, the pages and cells it wants are asked, those read
     *  handed to the page worker pool, those decoded opened or placed while the frame's `budget`
     *  admits them, and the HLOD cells hold their roots and tell the cut what they are. True when a
     *  page or cell it wants is left for a later frame. */
    frame(eye: ArrayLike<number>, io: CellFrameIo, budget: CellBudget, axis?: ArrayLike<number>) {
      if (io !== given) at.catalogue = sharedCatalogue((given = io), share, self)
      at.io = io
      at.budget = budget
      frame.compose = io.compose
      rows.follow()
      const local = view(eye, axis)
      if (local.rung > Math.max(sized, wanted)) {
        wanted = local.rung
        // Twice the side that outgrew them, as buffers grow: an ongoing zoom resizes O(log) times.
        const rung = clamp(sized + 2, local.rung, RUNGS)
        if (!io.grow || !resize(rung, io.grow)) io.outgrown?.()
      }
      // The ranges are read in the cells' frame, the world DAG's at this placement's pose.
      cells = io.world
      const planned = plan(local.eye, ranges, held, pageFailed, cells && hlod)
      for (const cell of planned.leave) rows.leave(cell)
      // A placed cell within the main grid's range draws its source meshes, one past it its HLOD 0
      // actor: the same rows, told apart in the HLOD view (`proxy`).
      for (const cell of held.keys())
        rows.proxy(cell, (planned.distances.get(cell) ?? Infinity) > ranges[0])
      hlod.follow(planned.leaves, local.eye, local.axis, cells, instance)
      at.catalogue.forget(index.forgotten())
      waiting = 0
      let later = takeDecoded(planned.pages, at, pageDecodes, pageUrl, decodePage, open)
      // A page opened now brings its cells to the next frame's plan.
      later ||= planned.pages.some((page) => page.body)
      later = takeDecoded(planned.visible, at, decodes, cellUrl, decode, place) || later
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
      const local = view(eye)
      if (sized < RUNGS) resize(owned ? Math.max(local.rung, wanted) : RUNGS)
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
      for (const cell of held.keys()) rows.leave(cell)
      // Its rows given back, its view asks none: the other placements size for theirs alone.
      share.needs.delete(self)
      sized = wanted = -1
      pageDecodes.clear()
      decodes.clear()
      touched.flush(io.update)
    },
    /** What a frame waits on: the next HLOD hold to land or fail, while one reads. */
    reads: holds.reads,
    /** The decodes asked since the last call: a still camera is drawn again once one lands. */
    decodes: () => [...pageDecodes.asked(), ...decodes.asked()],
  }
  return partitionCells
}

export type PartitionCells = ReturnType<typeof createPartitionCells>
