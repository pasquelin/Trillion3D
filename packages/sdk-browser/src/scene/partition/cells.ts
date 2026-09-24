/**
 * THE CELLS OF A PARTITIONED SCENE, READ BY DISTANCE (#404).
 *
 * The scene tables leave the nodes that only place a mesh to spatial cells (`tablePartition.ts`).
 * Before each frame (`frame`), the cells the camera needs (`plan.ts`) are asked of the session's
 * page streamer — the one request queue, verified by fingerprint like any page — nearest first,
 * then those one diagonal ahead at the prefetch priority,
 * and those it holds are placed within the arrival budget: each node takes a row of its mesh
 * (`rows.ts`), written with the world matrix the engine composes for a child of its core parent
 * (`hostWorldChainInto`, `hostLocalInto`), the same bits a host node there would have had. A cell
 * past its reach gives its rows back, parked. A parent that moved rewrites the rows under it.
 * Before the session's first frame, `prime` reads the cells its first camera needs, and nothing
 * else: what the first frame costs is bounded by the view, not by the world.
 */
import { MATRIX_VALUES, multiplyMatrix4, EngineError } from '../../../../sdk-core/src/index.ts';
import {
  assertCellNodes,
  type TablePartition,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { GraphNode } from '../../host/graph/node.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import { inCellFrame, planCells } from './plan.ts';
import {
  releaseRow,
  rowLocal,
  reserveRows,
  takeRow,
  type GrowRows,
  type PlacedMesh,
  type RowLink,
} from './rows.ts';

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
  const held = new Map<number, Placement[]>();
  /** The world matrix each parent in use had when its rows were written. */
  const worlds = new Map<GraphNode, Float64Array>();
  const touched = new Map<RowLink, { from: number; to: number }>();
  let waiting = 0;
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
  /** Places `cell` from its bytes; false when a mesh is short of rows and nothing may grow. */
  const place = (cell: number, bytes: Uint8Array, grow: GrowRows | undefined) => {
    const nodes = assertCellNodes(JSON.parse(new TextDecoder().decode(bytes)));
    const needed = new Map<PlacedMesh, number>();
    for (const node of nodes) {
      const mesh = meshes.get(node.mesh);
      if (!mesh)
        throw new EngineError('PREPARED_SCENE_MISMATCH', `a scene cell places mesh ${node.mesh}`, {
          cell: cells[cell].url,
        });
      needed.set(mesh, (needed.get(mesh) ?? 0) + 1);
    }
    for (const [mesh, count] of needed) if (mesh.free.length < count && !grow) return false;
    for (const [mesh, count] of needed) reserveRows(mesh, count, grow!);
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
    /** The cells placed now, and those a mesh short of rows keeps waiting. */
    stats: () => ({ cells: cells.length, held: held.size, waiting }),
    /** Before a frame seen from `eye`: far cells leave, near ones are asked for, nearest first,
     *  then those ahead, and those already read are placed within `budgetMs` — one at least. */
    frame(
      eye: ArrayLike<number>,
      reach: (size: number) => number,
      /** What a frame reads and writes through the session: the verified bytes the streamer
       *  holds, whether it is reading an address, a request — `ahead` for cells read before they
       *  are needed —, rows written, and a buffer grown; without `grow`, a mesh short of rows
       *  keeps its cell waiting. */
      io: {
        bytes(url: string): Uint8Array | undefined;
        loading(url: string): boolean;
        request(urls: readonly string[], ahead: boolean): void;
        update(rows: PlacementRows, from: number, to: number): void;
        grow?: (from: PlacementRows, to: PlacementRows) => void;
      },
      budgetMs: number,
    ) {
      followParents();
      const local = inCellFrame(hostWorldChainInto(rootWorld, root), eye, reach);
      const plan = planCells(cells, local.eye, local.reach, new Set(held.keys()));
      plan.leave.forEach(leave);
      const started = performance.now();
      let placed = 0;
      waiting = 0;
      for (const [list, ahead] of [
        [plan.visible, false],
        [plan.ahead, true],
      ] as const) {
        const ask: string[] = [];
        for (const cell of list) {
          const { url } = cells[cell];
          const bytes = io.bytes(url);
          if (!bytes) {
            if (!io.loading(url)) ask.push(url);
            continue;
          }
          if (placed && performance.now() - started > budgetMs) continue;
          if (place(cell, bytes, io.grow)) placed++;
          else waiting++;
        }
        if (ask.length) io.request(ask, ahead);
      }
      flush(io.update);
    },
    /** Reads and places every cell a camera at `eye` needs — within its reach, none ahead —,
     *  before the session reads the rows; resolves with the bytes read. */
    async prime(
      eye: ArrayLike<number>,
      reach: (size: number) => number,
      read: (url: string) => Promise<Uint8Array>,
    ) {
      const local = inCellFrame(hostWorldChainInto(rootWorld, root), eye, reach);
      const { visible } = planCells(cells, local.eye, local.reach, new Set(held.keys()));
      const bodies = await Promise.all(visible.map((cell) => read(cells[cell].url)));
      visible.forEach((cell, at) => place(cell, bodies[at], () => {}));
      touched.clear();
      return bodies.reduce((sum, bytes) => sum + bytes.byteLength, 0);
    },
  };
}

export type PartitionCells = ReturnType<typeof createPartitionCells>;
