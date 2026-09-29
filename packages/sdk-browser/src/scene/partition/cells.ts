/**
 * THE CELLS OF A PARTITIONED SCENE, READ BY DISTANCE (#404).
 *
 * Before each frame (`frame`), the cells the camera needs (`plan.ts`, found through the cell index
 * the pages form, `cellIndex.ts`, boxed where their parents stand now: `boxes.ts`) are asked of the
 * session's page streamer, nearest first, then those ahead at the prefetch priority; those it
 * holds are decoded off the main thread (`cellDecode.ts`, `decodes.ts`), and those decoded placed
 * within the frame's one integration budget (`FrameBudget`), each node on a row of its mesh at the
 * world matrix the engine composes for a child of its core parent (`placements.ts`), the cell
 * holding its manifest pages (`cellPages.ts`).
 * A cell past its reach parks its rows and releases its pages; a moved parent rewrites its rows.
 * `prime`, before the first frame, sizes the rows for every node the reach can hold at once
 * wherever the parents stand (`sizing.ts`; every node when no owner can reopen the session) and
 * reads the cells it needs. Parents moved, turned or scaled up never run the rows short; a reach past
 * them, or a parent shrunk or stretched unevenly, grows them in place, else reopens (`growth.ts`).
 */
import { MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { PlacementGrowth } from '../../placement/backendSceneUpdates.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import { createCellBoxes, ranksOf } from './boxes.ts';
import { createCellIndex } from './cellIndex.ts';
import type { CellRows } from './cellDecode.ts';
import { createCellDecodes } from './decodes.ts';
import { inCellFrame, planCells } from './plan.ts';
import { holdsEvery, outstretched, residentRows, sizedStretch, type Stretch } from './sizing.ts';
import { capacityOf, sizeRows, type PlacedMesh } from './rows.ts';
import { createCellPlacements } from './placements.ts';
import { createCellPages, withHoldings } from './cellPages.ts';

type Inputs = {
  partition: TablePartition;
  /** The folder the tables were read from. */ base: string;
  /** The prepared scene's root: where the tables hang a cell node. */ root: Object3D;
  /** The host node of each core rank. */ parents: readonly Object3D[];
  /** The placed mesh of each mesh rank the cells place. */ meshes: ReadonlyMap<number, PlacedMesh>;
  /** The manifest's pages the view holds (#751). */ pages?: Parameters<typeof createCellPages>[0];
};

const rootWorld = new Float64Array(MATRIX_VALUES);

export function createPartitionCells(inputs: Inputs) {
  const { partition, base, root, parents, meshes } = inputs;
  const cells = partition.cells.map((cell) => ({ ...cell, url: new URL(cell.url, base).href }));
  const boxes = createCellBoxes(ranksOf(partition.cells), root, parents);
  const index = createCellIndex(partition.regions, partition.cells, boxes);
  const decodes = createCellDecodes();
  const manifest = createCellPages(inputs.pages, partition.cells);
  const rows = createCellPlacements(root, parents, meshes);
  const { held, touched } = rows;
  /** Cells short of rows; whether the owner was asked to reopen; the reach, in the cells' frame,
   *  the rows are sized for (∞: all); the largest a frame asked; each parent's stretch sized for. */
  let waiting = 0,
    short = false,
    sized = 0,
    wanted = 0,
    stretched: ReadonlyMap<number, Stretch> = new Map();
  /** Places `cell` from its decoded rows; false when a mesh is short of rows (a reach past
   *  `sized`). */
  const place = (cell: number, decoded: CellRows) => {
    if (!rows.place(cell, decoded, cells[cell].url)) return false;
    decodes.drop(cell);
    manifest.hold(cell);
    return true;
  };
  const leave = (cell: number) => {
    rows.leave(cell);
    manifest.release(cell);
  };
  /** Sizes the rows for `bound` and `stretch`, in place under `grow`; false, unsized, if refused. */
  const resize = (bound: number, grow?: PlacementGrowth, stretch = sizedStretch(boxes.stretch)) => {
    const needed = residentRows(partition.cells, bound, stretch);
    if (!sizeRows(meshes, needed, grow)) return false;
    stretched = stretch;
    sized = holdsEvery(needed, cells) ? Infinity : bound;
    short = false;
    return true;
  };
  const partitionCells = {
    /** Every cell as the streamer's catalogue reads it. */
    pages: cells.map(({ url, bytes, sha256 }) => ({ url, bytes, sha256 })),
    /** The cells placed now, those a mesh short of rows keeps waiting, and the rows sized. */
    stats: () => ({
      cells: cells.length,
      held: held.size,
      waiting,
      rows: [...meshes.values()].reduce((sum, mesh) => sum + capacityOf(mesh), 0),
    }),
    /** Before a frame from `eye`: far cells leave, near ones are asked, those read handed to the
     *  decode pool, those decoded placed while the frame's `budget` admits them. True when a cell
     *  within reach is left for a later frame. */
    frame(
      eye: ArrayLike<number>,
      reach: number,
      /** The streamer's verified bytes, their decode off the main thread, whether it reads an
       *  address, a request (`ahead`: read before needed), rows written, a buffer grown in place
       *  where it can, else the owner told. */
      io: {
        bytes(url: string): Uint8Array | undefined;
        decode(bytes: Uint8Array): Promise<CellRows>;
        loading(url: string): boolean;
        request(urls: readonly string[], ahead: boolean): void;
        update(rows: PlacementRows, from: number, to: number): void;
        grow?: PlacementGrowth;
        outgrown?: () => void;
      },
      budget: { admits(): boolean; spend(): void }, // structurally a `FrameBudget`, kept internal
    ) {
      rows.follow();
      const local = inCellFrame(hostWorldChainInto(rootWorld, root), eye, reach);
      boxes.refresh();
      const plan = planCells(index, local.eye, local.reach, held);
      const beyond = local.reach > Math.max(sized, wanted);
      if (beyond) wanted = local.reach;
      const over = !short && sized < Infinity && outstretched(boxes.stretch, stretched);
      if (beyond || over) {
        // Twice what outgrew them, as buffers grow: an ongoing zoom or shrink resizes O(log) times.
        const stretch = over ? sizedStretch(boxes.stretch, 2) : stretched;
        const bound = beyond ? Math.max(2 * sized, wanted) : sized;
        if (!io.grow || !resize(bound, io.grow, stretch)) {
          short = true;
          io.outgrown?.();
        }
      }
      plan.leave.forEach(leave);
      waiting = 0;
      let later = false;
      for (const [list, ahead] of [
        [plan.visible, false],
        [plan.ahead, true],
      ] as const) {
        const ask: string[] = [];
        for (const cell of list) {
          const { url } = cells[cell];
          const rows = decodes.rows(cell, () => io.bytes(url), io.decode);
          if (!rows || !budget.admits()) {
            if (!decodes.has(cell) && !io.loading(url)) ask.push(url);
            later ||= !ahead;
            continue;
          }
          if (place(cell, rows)) budget.spend();
          else waiting++;
        }
        if (ask.length) io.request(ask, ahead);
      }
      decodes.keep(new Set([...plan.visible, ...plan.ahead]));
      touched.flush(io.update);
      return later;
    },
    /** Before the engines read the rows: sizes them for the camera at `eye` or the largest reach a
     *  frame asked (every cell unless `owned`), then places the cells within reach, each read and
     *  decoded through `read`; bytes read. */
    async prime(
      eye: ArrayLike<number>,
      reach: number,
      read: (url: string) => Promise<CellRows>,
      owned: boolean,
    ) {
      const local = inCellFrame(hostWorldChainInto(rootWorld, root), eye, reach);
      boxes.refresh();
      const plan = planCells(index, local.eye, local.reach, held);
      plan.leave.forEach(leave);
      if (sized < Infinity) resize(owned ? Math.max(local.reach, wanted) : Infinity);
      const bodies = await Promise.all(plan.visible.map((cell) => read(cells[cell].url)));
      plan.visible.forEach((cell, at) => place(cell, bodies[at]));
      touched.clear();
      return bodies.reduce((sum, rows) => sum + rows.bytes, 0);
    },
    /** The decodes the frames asked since the last call: a still camera is drawn again once one
     *  lands, so the cell it brings is placed. */
    decodes: decodes.asked,
  };
  return withHoldings({ meshes, manifest }, partitionCells);
}

export type PartitionCells = ReturnType<typeof createPartitionCells>;
