/**
 * THE CELLS OF A PARTITIONED SCENE, READ BY DISTANCE (#404).
 *
 * Before each frame (`frame`), the pages of the cell index and the cells the camera needs
 * (`plan.ts`, `cellIndex.ts`, boxed where their parents stand now: `boxes.ts`) are asked of the
 * session's page streamer, nearest first, then those ahead at the prefetch priority; those it holds
 * are decoded off the main thread (`cellDecode.ts`, `decodes.ts`), and those decoded opened or
 * placed within the frame's one integration budget (`FrameBudget`): a page lists its pages or
 * cells to the streamer's catalogue, a cell puts each node on a row of its mesh at the world matrix
 * the engine composes for a child of its core parent, casting as its host mesh says
 * (`placements.ts`, `follow.ts`), holding the world bundles its roots need (`cellHolds.ts`). A
 * cell past its reach parks its rows and releases its bundles; a page past it
 * with no cell placed is closed and its files leave the catalogue; a moved parent, or a host mesh's
 * `castShadow` changed, rewrites its rows.
 * `prime`, before the first frame, sizes the rows for the first camera's view (`sizing.ts`; every
 * node when no owner can reopen the session), then reads the pages on its way and the cells it
 * reaches (#575). A reach past those rows, or a parent shrunk or stretched unevenly, grows them in
 * place, else asks the owner to open the session again (`placement/growth.ts`).
 */
import { RUNGS, type TablePartition } from '../../../sdk-core/src/scene/core/tablePartition.ts'
import type { PlacementGrowth } from '../placement/engineSceneUpdates.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import { createCellBoxes } from './boxes.ts'
import { createCellIndex, type IndexPage, type PageBody } from './cellIndex.ts'
import type { CellRows } from './cellDecode.ts'
import { createDecodes, takeDecoded } from './decodes.ts'
import { holdPriority, inCellFrame, planCells } from './plan.ts'
import { capacityOf, sizeRows, type PlacedMesh } from './rows.ts'
import { heldSide, rowsAt, rungOf } from './sizing.ts'
import { createCellPlacements } from './placements.ts'
import { createCellHolds } from './cellHolds.ts'
import { createFarCells } from './farCells.ts'
import type { PlacementRows } from '../placement/rows.ts'
import type { StreamPage } from '../streaming/types.ts'

/** Where a frame sees the cells from, in their frame, and whether the list it places is read
 *  ahead. */
type Seen = { local: { eye: ArrayLike<number>; reach: number }; ahead: boolean }

type Inputs = {
  partition: TablePartition
  /** The folder the tables were read from. */ base: string
  /** The prepared scene's root: where the tables hang a cell node. */ root: Object3D
  /** The host node of each core rank. */ parents: readonly Object3D[]
  /** The placed mesh of each mesh rank the cells place. */ meshes: ReadonlyMap<number, PlacedMesh>
  /** The world bundles its roots need (#1237). */ world?: Parameters<typeof createFarCells>[0]
}

export function createPartitionCells(inputs: Inputs) {
  const { partition, base, root, parents, meshes, world } = inputs
  const boxes = createCellBoxes(partition.parents, root, parents)
  const index = createCellIndex(partition.pages, base, boxes)
  const decodes = createDecodes<number, CellRows>(),
    pageDecodes = createDecodes<IndexPage, PageBody>()
  const holds = createCellHolds(world)
  const rows = createCellPlacements(root, parents, meshes)
  const { held, touched } = rows
  const far = createFarCells(world, held)
  /** Cells waiting for rows; the rung the rows are sized for (`RUNGS`: all); the widest asked. */
  let waiting = 0,
    sized = -1,
    wanted = -1
  /** Where the camera at `eye` stands in the cells' frame, and the rung its view asks. */
  const view = (eye: ArrayLike<number>, reach: number) => {
    const local = inCellFrame(resolveCameraWorld(root).worldMatrix, eye, reach)
    boxes.refresh()
    const rung = rungOf(heldSide(local.reach, partition.cube, boxes.stretch), partition.cube)
    return { ...local, rung }
  }
  /** Sizes the rows for `rung`, in place under `grow`; false, unsized, if refused. */
  const resize = (rung: number, grow?: PlacementGrowth) => {
    if (!sizeRows(meshes, rowsAt(partition, rung), grow)) return false
    // Rows that hold every node hold any view: no wider rung asks for more.
    const every = [...partition.totals].every(([mesh, total]) => {
      const placed = meshes.get(mesh)
      return !placed || capacityOf(placed) >= total
    })
    sized = every ? RUNGS : Math.max(sized, rung)
    return true
  }
  const cellUrl = (cell: number) => index.cell(cell).url
  /** Places `cell`, seen from `local` in a list read `ahead` or not, its holds read at the plan's
   *  priority once its rows took it (`holdPriority`). */
  const place = (cell: number, decoded: CellRows, { local, ahead }: Seen) =>
    rows.place(cell, decoded, cellUrl(cell)) &&
    (holds.hold(cell, holdPriority(index, local, cell, ahead)), true)
  /** A cell held far lets its super-roots go (`farCells.ts`), a placed one its rows and pages. */
  const leave = (cell: number) => far.release(cell) || (rows.leave(cell), holds.release(cell))
  const partitionCells = {
    /** The root's pages, the files the streamer's catalogue holds at open. */
    pages: index.slots,
    /** The pages of the index opened and the cells they list, the cells placed now, those a mesh
     *  short of rows keeps waiting, and the rows sized. */
    stats: () => ({
      ...index.stats(),
      held: held.size,
      waiting,
      rows: [...meshes.values()].reduce((sum, mesh) => sum + capacityOf(mesh), 0),
    }),
    /** Before a frame from `eye`: far cells leave and far pages close, rows past those sized grow,
     *  near pages and cells are asked, those read handed to the page worker pool, those decoded opened
     *  or placed while the frame's `budget` admits them. True when a page or cell within reach is
     *  left for a later frame. */
    frame(
      eye: ArrayLike<number>,
      reach: number,
      /** Kept internal as `budget` is: the streamer's verified bytes and their decode off the main
       *  thread, those refused for good, requests (`ahead`: before needed), catalogue, rows, else
       *  the owner told. */
      io: {
        bytes(url: string): Uint8Array | undefined
        decode: (bytes: Uint8Array, url: string) => Promise<CellRows>
        decodePage: (bytes: Uint8Array, url: string) => Promise<PageBody>
        /** Whether a read of `url` is refused for good (`PageStreamer.failed`). */
        failed(url: string): boolean
        request(urls: readonly string[], ahead: boolean): void
        admit(pages: readonly StreamPage[]): void
        forget(urls: readonly string[]): void
        update(rows: PlacementRows, from: number, to: number): void
        grow?: PlacementGrowth
        outgrown?: () => void
        /** The cut's lens while it packs the world DAG, structurally a `SuperRootLens`. */
        lens?: {
          pixelScale: [number, number]
          pixelError: number
          near: number
          perspective?: number
          slope: number
        }
      },
      budget: { admits(): boolean; spend(): void }, // structurally a `FrameBudget`, kept internal
    ) {
      rows.follow()
      const local = view(eye, reach)
      if (local.rung > Math.max(sized, wanted)) {
        wanted = local.rung
        // Twice the side that outgrew them, as buffers grow: an ongoing zoom resizes O(log) times.
        const rung = Math.min(RUNGS, Math.max(local.rung, sized + 2))
        if (!io.grow || !resize(rung, io.grow)) io.outgrown?.()
      }
      const plan = far.plan(index, local, eye, io.lens, leave)
      plan.leave.forEach(leave)
      io.forget(index.forgotten())
      waiting = 0
      let later = false
      const open = (page: IndexPage, body: PageBody) => (io.admit(index.open(page, body)), true)
      const pageUrl = (page: IndexPage) => page.slot.url
      for (const ahead of [false, true]) {
        const pages = ahead ? plan.pages.ahead : plan.pages.visible
        const at = { io, budget, ahead }
        later = takeDecoded(pages, at, pageDecodes, pageUrl, io.decodePage, open) || later
        // A page opened now brings its cells to the next frame's plan.
        later ||= !ahead && pages.some((page) => page.body)
        const list = ahead ? plan.ahead : plan.visible
        const placed = (cell: number, decoded: CellRows) =>
          place(cell, decoded, { local, ahead }) || (waiting++, false)
        later = takeDecoded(list, at, decodes, cellUrl, io.decode, placed) || later
      }
      pageDecodes.keep(plan.pages.visible, plan.pages.ahead)
      decodes.keep(plan.visible, plan.ahead)
      touched.flush(io.update)
      return later
    },
    /** Before the engines read the rows: sizes them for the camera at `eye` or the widest view a
     *  frame asked (every node unless `owned`), then reads the pages of the index on its way and
     *  places the cells within its reach; the bytes read. */
    async prime(
      eye: ArrayLike<number>,
      reach: number,
      /** Kept internal as `frame`'s: the streamer's verified read, the decodes, the catalogue. */
      io: {
        read(url: string): Promise<Uint8Array>
        decode: (bytes: Uint8Array, url: string) => Promise<CellRows>
        decodePage: (bytes: Uint8Array, url: string) => Promise<PageBody>
        admit(pages: readonly StreamPage[]): void
      },
      owned: boolean,
    ) {
      const local = view(eye, reach)
      if (sized < RUNGS) resize(owned ? Math.max(local.rung, wanted) : RUNGS)
      let bytes = 0
      const read = async <T>(url: string, decode: (got: Uint8Array, url: string) => Promise<T>) => {
        const got = await io.read(url)
        bytes += got.byteLength
        return decode(got, url)
      }
      let plan = planCells(index, local.eye, local.reach, held)
      for (let unread = plan.pages.visible; unread.length; unread = plan.pages.visible) {
        const bodies = await Promise.all(unread.map((p) => read(p.slot.url, io.decodePage)))
        unread.forEach((page, at) => io.admit(index.open(page, bodies[at])))
        plan = planCells(index, local.eye, local.reach, held)
      }
      plan.leave.forEach(leave)
      const decoded = await Promise.all(plan.visible.map((c) => read(cellUrl(c), io.decode)))
      const seen = { local, ahead: false }
      plan.visible.forEach((cell, at) => place(cell, decoded[at], seen))
      touched.clear()
      return bytes
    },
    /** What a frame waits on: the next hold, placed or far, to land or fail, while one reads. */
    reads: () => [...holds.reads(), ...far.reads()],
    /** The decodes asked since the last call: a still camera is drawn again once one lands. */
    decodes: () => [...pageDecodes.asked(), ...decodes.asked()],
  }
  return partitionCells
}

export type PartitionCells = ReturnType<typeof createPartitionCells>
