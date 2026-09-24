/**
 * THE CELLS OF A PARTITIONED SCENE, READ BY DISTANCE (#404).
 *
 * Before each frame (`frame`), the cells the camera needs (`plan.ts`, boxed where their parents
 * stand now: `boxes.ts`) are asked of the session's page streamer, nearest first, then those ahead
 * at the prefetch priority; those it holds are placed within the arrival budget, each node on a
 * row of its mesh (`rows.ts`) at the world matrix the engine composes for a child of its core
 * parent. A cell past its reach parks its rows; a moved parent rewrites the rows under it.
 * `prime`, before the first frame, sizes the rows for every node the reach can hold at once
 * (`residentRows`; every node when no owner can reopen the session) and reads the cells it needs.
 * A reach past the rows, or parents moved so close a cell is short of them, asks the owner to
 * reopen: nothing grows under an engine.
 */
import { MATRIX_VALUES, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import {
  assertCellNodes,
  type TablePartition,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { GraphNode } from '../../host/graph/node.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import { createCellBoxes } from './boxes.ts';
import { holdsEvery, inCellFrame, planCells, residentRows } from './plan.ts';
import { capacityOf, releaseRow, rowLocal, rowsFree, sizeRows, takeRow } from './rows.ts';
import type { PlacedMesh, RowLink } from './rows.ts';

type Read = (url: string) => Promise<Uint8Array>;
type Placement = { mesh: PlacedMesh; row: number; parent: GraphNode; local: Float64Array };
type Inputs = {
  partition: TablePartition;
  /** The folder the tables were read from. */
  base: string;
  /** The prepared scene's root: the parent of a cell node the tables hang on the scene. */
  root: GraphNode;
  /** The host node of each core rank. */
  parents: readonly GraphNode[];
  /** The placed mesh of each mesh rank the cells place. */
  meshes: ReadonlyMap<number, PlacedMesh>;
};

const product = new Float64Array(MATRIX_VALUES);
const rootWorld = new Float64Array(MATRIX_VALUES);

export function createPartitionCells(inputs: Inputs) {
  const { partition, base, root, parents, meshes } = inputs;
  const cells = partition.cells.map((cell) => ({ ...cell, url: new URL(cell.url, base).href }));
  const boxes = createCellBoxes(partition.cells, root, parents);
  const held = new Map<number, Placement[]>();
  /** The world matrix each parent in use had when its rows were written. */
  const worlds = new Map<GraphNode, Float64Array>();
  const touched = new Map<RowLink, { from: number; to: number }>();
  let waiting = 0,
    short = false;
  /** The reach, in the cells' frame, the rows are sized for (∞: all); the largest a frame asked. */
  let sized = 0,
    wanted = 0;
  const worldOf = (node: GraphNode) => {
    let world = worlds.get(node);
    if (!world) worlds.set(node, (world = hostWorldChainInto(new Float64Array(16), node)));
    return world;
  };
  const touch = (link: RowLink, row: number) => {
    const range = touched.get(link);
    if (range) {
      range.from = Math.min(range.from, row);
      range.to = Math.max(range.to, row);
    } else touched.set(link, { from: row, to: row });
  };
  const write = (placement: Placement) => {
    const { mesh, row } = placement;
    multiplyMatrix4(product, worldOf(placement.parent), placement.local);
    for (const link of mesh.links) {
      const rows = link.placements!;
      rows.matrices.set(product, row * 16);
      rows.live[row] = 1;
      touch(link, row);
    }
  };
  /** Places `cell` from its bytes; false when a mesh is short of rows (a reach past `sized`). */
  const place = (cell: number, bytes: Uint8Array) => {
    const nodes = assertCellNodes(JSON.parse(new TextDecoder().decode(bytes)));
    if (!rowsFree(meshes, nodes, cells[cell].url)) return false;
    const placements = nodes.map((node) => {
      const parent = node.parent === null ? root : parents[node.parent];
      const mesh = meshes.get(node.mesh)!;
      const placement = { mesh, row: takeRow(mesh), parent, local: rowLocal(node) };
      write(placement);
      return placement;
    });
    held.set(cell, placements);
    return true;
  };
  const leave = (cell: number) => {
    for (const { mesh, row } of held.get(cell)!) {
      releaseRow(mesh, row);
      for (const link of mesh.links) touch(link, row);
    }
    held.delete(cell);
  };
  /** Rewrites the rows under every parent whose world moved since they were written. */
  const followParents = () => {
    for (const [node, world] of worlds) {
      hostWorldChainInto(product, node);
      if (product.every((value, at) => Object.is(value, world[at]))) continue;
      world.set(product);
      for (const placements of held.values())
        for (const placement of placements) if (placement.parent === node) write(placement);
    }
  };
  const flush = (update: (rows: PlacementRows, from: number, to: number) => void) => {
    for (const [link, { from, to }] of touched) update(link.placements!, from, to);
    touched.clear();
  };
  return {
    /** Every cell as the streamer's catalogue reads it. */
    pages: cells.map(({ url, bytes, sha256 }) => ({ url, bytes, sha256 })),
    /** The cells placed now, those a mesh short of rows keeps waiting, and the rows sized. */
    stats: () => ({
      cells: cells.length,
      held: held.size,
      waiting,
      rows: [...meshes.values()].reduce((sum, mesh) => sum + capacityOf(mesh), 0),
    }),
    /** Before a frame from `eye`: far cells leave, near ones are asked, those read placed within
     *  `budgetMs` (one at least). True when a cell within reach is left for a later frame. */
    frame(
      eye: ArrayLike<number>,
      reach: number,
      /** The streamer's verified bytes, whether it reads an address, a request (`ahead`: read
       *  before needed), rows written, and the owner told once the reach outgrew the rows. */
      io: {
        bytes(url: string): Uint8Array | undefined;
        loading(url: string): boolean;
        request(urls: readonly string[], ahead: boolean): void;
        update(rows: PlacementRows, from: number, to: number): void;
        outgrown?: () => void;
      },
      budgetMs: number,
    ) {
      followParents();
      const local = inCellFrame(hostWorldChainInto(rootWorld, root), eye, reach);
      if (local.reach > Math.max(sized, wanted)) {
        wanted = local.reach;
        io.outgrown?.();
      }
      const plan = planCells(boxes(), local.eye, local.reach, new Set(held.keys()));
      plan.leave.forEach(leave);
      const started = performance.now();
      let placed = 0;
      waiting = 0;
      let later = false;
      for (const [list, ahead] of [
        [plan.visible, false],
        [plan.ahead, true],
      ] as const) {
        const ask: string[] = [];
        for (const cell of list) {
          const { url } = cells[cell];
          const bytes = io.bytes(url);
          if (!bytes || (placed && performance.now() - started > budgetMs)) {
            if (!bytes && !io.loading(url)) ask.push(url);
            later ||= !ahead;
            continue;
          }
          if (place(cell, bytes)) placed++;
          else waiting++;
        }
        if (ask.length) io.request(ask, ahead);
      }
      if (waiting && !short && sized < Infinity) {
        short = true; // parents moved together: the rows sized at open no longer hold them
        io.outgrown?.();
      }
      flush(io.update);
      return later;
    },
    /** Before the engines read the rows: sizes them for the camera at `eye` or the largest reach a
     *  frame asked (every cell unless `owned`), then places the cells within reach; bytes read. */
    async prime(eye: ArrayLike<number>, reach: number, read: Read, owned: boolean) {
      const local = inCellFrame(hostWorldChainInto(rootWorld, root), eye, reach);
      const plan = planCells(boxes(), local.eye, local.reach, new Set(held.keys()));
      plan.leave.forEach(leave);
      const bound = owned ? Math.max(local.reach, wanted) : Infinity;
      if (sized < Infinity) {
        // Sized on where the cells stand now; rows that hold every node are never short.
        const rows = residentRows(boxes(), bound);
        sizeRows(meshes, rows);
        sized = holdsEvery(rows, cells) ? Infinity : bound;
        short = false;
      }
      const { visible } = plan;
      const bodies = await Promise.all(visible.map((cell) => read(cells[cell].url)));
      visible.forEach((cell, at) => place(cell, bodies[at]));
      touched.clear();
      return bodies.reduce((sum, bytes) => sum + bytes.byteLength, 0);
    },
  };
}

export type PartitionCells = ReturnType<typeof createPartitionCells>;
