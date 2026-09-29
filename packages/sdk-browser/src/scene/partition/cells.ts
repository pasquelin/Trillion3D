/**
 * THE CELLS OF A PARTITIONED SCENE, READ BY DISTANCE (#404).
 *
 * At open, only the partition's root is held (#575): the rows are sized from its node totals for
 * every node the cells place (`rows.ts`), once, so nothing grows and no session is reopened
 * wherever the camera goes or the page moves the cells' parents. Before each frame (`frame`), the
 * pages of the cell index and the cells the camera needs (`plan.ts`, `cellIndex.ts`, boxed where
 * their parents stand now: `boxes.ts`) are asked of the session's page streamer, nearest first,
 * then those ahead at the prefetch priority; those it holds are decoded off the main thread
 * (`cellDecode.ts`, `decodes.ts`), and those decoded opened or placed within the frame's one
 * integration budget (`FrameBudget`): a page lists its pages or cells to the streamer's catalogue,
 * a cell puts each node on a row of its mesh at the world matrix the engine composes for a child
 * of its core parent (`placements.ts`), holding its manifest pages (`cellPages.ts`). A cell past
 * its reach parks its rows and releases its pages; a page past it with no cell placed is closed
 * and its files leave the catalogue; a moved parent rewrites its rows.
 */
import { MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { StreamPage } from '../../streaming/types.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import { createCellBoxes } from './boxes.ts';
import { createCellIndex, type IndexPage, type PageBody } from './cellIndex.ts';
import type { CellRows } from './cellDecode.ts';
import { createDecodes } from './decodes.ts';
import { inCellFrame, planCells } from './plan.ts';
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
/** What a frame reads through: the streamer's verified bytes and their decode off the main thread,
 *  whether it reads an address, a request (`ahead`: read before needed), the catalogue's files
 *  taken and let go, and the rows written. */
type Io = {
  bytes(url: string): Uint8Array | undefined;
  decode(bytes: Uint8Array): Promise<CellRows>;
  decodePage(bytes: Uint8Array): Promise<PageBody>;
  loading(url: string): boolean;
  request(urls: readonly string[], ahead: boolean): void;
  admit(pages: readonly StreamPage[]): void;
  forget(urls: readonly string[]): void;
  update(rows: PlacementRows, from: number, to: number): void;
};

const rootWorld = new Float64Array(MATRIX_VALUES);

export function createPartitionCells(inputs: Inputs) {
  const { partition, base, root, parents, meshes } = inputs;
  const boxes = createCellBoxes(partition.parents, root, parents);
  const index = createCellIndex(partition.pages, base, boxes);
  const decodes = createDecodes<number, CellRows>(),
    pageDecodes = createDecodes<IndexPage, PageBody>();
  const manifest = createCellPages(inputs.pages, (cell) => index.cell(cell).meshPages);
  const rows = createCellPlacements(root, parents, meshes);
  const { held, touched } = rows;
  sizeRows(meshes, partition.totals);
  /** Cells a mesh short of rows keeps waiting: none, unless the root undercounts them. */
  let waiting = 0;
  const leave = (cell: number) => {
    rows.leave(cell);
    manifest.release(cell);
  };
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
    /** Before a frame from `eye`: far cells leave and far pages close, near ones are asked, those
     *  read handed to the decode pool, those decoded opened or placed while the frame's `budget`
     *  admits them. True when a page or cell within reach is left for a later frame. */
    frame(
      eye: ArrayLike<number>,
      reach: number,
      io: Io,
      budget: { admits(): boolean; spend(): void }, // structurally a `FrameBudget`, kept internal
    ) {
      rows.follow();
      const local = inCellFrame(hostWorldChainInto(rootWorld, root), eye, reach);
      boxes.refresh();
      const plan = planCells(index, local.eye, local.reach, held);
      plan.leave.forEach(leave);
      io.forget(index.forgotten());
      waiting = 0;
      let later = false;
      /** Takes the files of `list` the budget admits once decoded (`taken`: false while it waits);
       *  asks the unread ones of the streamer. */
      const take = <Key, Decoded extends object>(
        list: readonly Key[],
        ahead: boolean,
        files: ReturnType<typeof createDecodes<Key, Decoded>>,
        url: (key: Key) => string,
        decode: (bytes: Uint8Array) => Promise<Decoded>,
        taken: (key: Key, decoded: Decoded) => boolean,
      ) => {
        const ask: string[] = [];
        for (const key of list) {
          const decoded = files.rows(key, () => io.bytes(url(key)), decode);
          if (!decoded || !budget.admits()) {
            if (!files.has(key) && !io.loading(url(key))) ask.push(url(key));
            later ||= !ahead;
            continue;
          }
          if (!taken(key, decoded)) continue;
          files.drop(key);
          budget.spend();
        }
        if (ask.length) io.request(ask, ahead);
      };
      const open = (page: IndexPage, body: PageBody) => {
        io.admit(index.open(page, body));
        return true;
      };
      const place = (cell: number, decoded: CellRows) => {
        if (!rows.place(cell, decoded, index.cell(cell).url)) {
          waiting++;
          return false;
        }
        manifest.hold(cell);
        return true;
      };
      const pageUrl = (page: IndexPage) => page.slot.url,
        cellUrl = (cell: number) => index.cell(cell).url;
      for (const ahead of [false, true]) {
        const pages = ahead ? plan.pages.ahead : plan.pages.visible;
        take(pages, ahead, pageDecodes, pageUrl, io.decodePage, open);
        // A page opened now brings its cells to the next frame's plan.
        later ||= !ahead && pages.some((page) => page.body);
        take(ahead ? plan.ahead : plan.visible, ahead, decodes, cellUrl, io.decode, place);
      }
      pageDecodes.keep(new Set([...plan.pages.visible, ...plan.pages.ahead]));
      decodes.keep(new Set([...plan.visible, ...plan.ahead]));
      touched.flush(io.update);
      return later;
    },
    /** The decodes the frames asked since the last call: a still camera is drawn again once one
     *  lands, so the page it brings is opened or the cell placed. */
    decodes: () => [...pageDecodes.asked(), ...decodes.asked()],
  };
  return withHoldings({ meshes, manifest }, partitionCells);
}

export type PartitionCells = ReturnType<typeof createPartitionCells>;
