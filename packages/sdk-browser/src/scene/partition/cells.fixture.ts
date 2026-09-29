import {
  readCellPage,
  type TableCell,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { cellRows, decodeCellFile } from './cellDecode.ts';
import { createPartitionCells, type PartitionCells } from './cells.ts';
import { paged } from './paged.fixture.ts';
import { placedMesh, type RowLink } from './rows.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { StreamPage } from '../../streaming/types.ts';

const BASE = 'https://cache.test/key/';

/** The rows the cook lists for the two cells below (`partition/pages/rows.rs`): the first rung
 *  16 m wide, and a window of a rung — one and a half times its side — holds both cells once it
 *  spans the 4 990 m between them, else the near cell's two nodes. */
const LADDER = {
  cube: 16,
  rows: (_: number, total: number, rung: number) => (24 * 2 ** (rung / 2) >= 4990 ? total : 2),
};

/** Two cells of one mesh, one near the origin and one 5 km away, each in a region page of its
 *  own; each hangs under a core node standing 10 m up, or under the scene root when its `far` or
 *  `near` is null. `drawn` are the host meshes of its two primitives. */
export function world(
  far: number | null = 0,
  near: number | null = null,
  drawn: readonly Object3D[] = [],
) {
  const node = (x: number, parent: number | null) => ({
    parent,
    mesh: 7,
    matrix: null,
    translation: [x, 1, 2],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    scale: [2, 2, 2],
  });
  const bodies: Record<string, unknown> = {
    'near.json': { version: 2, nodes: [node(1, near), node(3, near)] },
    'far.json': { version: 2, nodes: [node(5000, far)] },
  };
  const cell = (url: string, rank: number | null, x: number, nodes: number): TableCell => ({
    url,
    sha256: '',
    bytes: 1,
    // Under the core node, 10 m up, or at the same place under the root.
    parents: [rank === null ? [null, [x, 0, 0, x + 10, 5, 5]] : [rank, [x, -10, 0, x + 10, -5, 5]]],
    meshes: [[7, nodes]],
    meshPages: [],
  });
  const table = [cell('near.json', near, 0, 2), cell('far.json', far, 5000, 1)];
  // Declared where the core node stands at open: 10 m up.
  const up = ({ parents: [[rank, box]] }: TableCell) =>
    rank === null ? box : [box[0], box[1] + 10, box[2], box[3], box[4] + 10, box[5]];
  const { partition, files } = paged(table, 1, up, LADDER);
  const root = new Group();
  const core = new Object3D();
  core.position.set(0, 10, 0);
  root.add(core);
  const links: RowLink[] = [
    { meshes: 7, primitives: 0 },
    { meshes: 7, primitives: 1 },
  ];
  const cells = createPartitionCells({
    partition,
    base: BASE,
    root,
    parents: [core],
    meshes: new Map([[7, placedMesh(links, drawn)]]),
  });
  const bytes = (url: string) => {
    const name = url.split('/').at(-1)!;
    return files.get(name) ?? new TextEncoder().encode(JSON.stringify(bodies[name]));
  };
  return { cells, links, root, core, bytes, node, files };
}

/** Reads a cell file into its rows on this thread, by the decode pool's own task. */
export const decodeHere = async (bytes: Uint8Array, url?: string) =>
  cellRows(decodeCellFile(bytes.slice().buffer as ArrayBuffer, url));

/** Opens `cells` as a session does before its first frame, for a camera at `eye` of `reach`,
 *  reading every file through `bytes` on this thread; the bytes read. */
export const opened = (
  cells: PartitionCells,
  bytes: (url: string) => Uint8Array,
  reach: number,
  owned = true,
  eye: ArrayLike<number> = [0, 0, 0],
) =>
  cells.prime(
    eye,
    reach,
    {
      read: async (url) => bytes(url),
      decode: decodeHere,
      decodePage: async (read, url) => readCellPage(read, url),
      admit() {},
    },
    owned,
  );

/** Frames of `cells` until one asks no decode and opens no page: each decode asked lands before the
 *  next frame, so the pages the view reaches are opened and the cells read placed; what the last
 *  frame returns. */
export async function settled(
  cells: PartitionCells,
  ...frame: Parameters<PartitionCells['frame']>
) {
  let opened = cells.stats().pages;
  for (let step = 0; ; step++) {
    const later = cells.frame(...frame);
    const asked = cells.decodes(),
      now = cells.stats().pages;
    if ((!asked.length && now === opened) || step > 64) return later;
    opened = now;
    await Promise.all(asked);
  }
}

type PartitionIo = Parameters<PartitionCells['frame']>[2];

/** `partition` opened with rows for every node, its first camera reaching nothing. */
export async function sizedWhole(partition: ReturnType<typeof world>) {
  await opened(partition.cells, partition.bytes, 100, false, [1e9, 0, 0]);
  return partition;
}

/** An io that holds every page of the index, and every cell of `held`; records what it is asked,
 *  what the catalogue takes and lets go, and how often the owner is asked to open anew. */
export function io(bytes: (url: string) => Uint8Array) {
  const asked: string[] = [],
    updates: [PlacementRows, number, number][] = [],
    admitted: StreamPage[] = [],
    forgotten: string[] = [];
  const held = new Set<string>(),
    outgrown = { count: 0 };
  const page = (url: string) => url.includes('/scene-page-');
  const port: PartitionIo = {
    bytes: (url) => (page(url) || held.has(url) ? bytes(url) : undefined),
    decode: decodeHere,
    decodePage: async (read, url) => readCellPage(read, url),
    loading: () => false,
    request: (urls) => void asked.push(...urls),
    admit: (pages) => void admitted.push(...pages),
    forget: (urls) => void forgotten.push(...urls),
    update: (rows, from, to) => updates.push([rows, from, to]),
    outgrown: () => void outgrown.count++,
  };
  return { port, asked, updates, held, admitted, forgotten, outgrown };
}

/** A reach past both cells. */
export const everywhere = 1e5;
/** No arrival budget: what a test places never depends on the time the machine takes. */
export const noBudget = { admits: () => true, spend() {} };
/** The address of the cell file `name`. */
export const cellUrl = (name: string) => `${BASE}${name}`;
