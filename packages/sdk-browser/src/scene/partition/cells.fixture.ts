import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { createPartitionCells, type PartitionCells } from './cells.ts';
import { placedMesh, type RowLink } from './rows.ts';

type PartitionIo = Parameters<PartitionCells['frame']>[2];

/** Two cells of one mesh, one near the origin and one 5 km away; each hangs under a moved core
 *  node, or under the scene root when its `far` or `near` is null. */
export function world(far: number | null = 0, near: number | null = null) {
  const node = (x: number, parent: number | null) => ({
    parent,
    mesh: 7,
    matrix: null,
    translation: [x, 1, 2],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    scale: [2, 2, 2],
  });
  const bodies: Record<string, unknown> = {
    'near.json': { version: 1, nodes: [node(1, near), node(3, near)] },
    'far.json': { version: 1, nodes: [node(5000, far)] },
  };
  const partition: TablePartition = {
    version: 1,
    bounds: [0, 0, 0, 5010, 5, 5],
    meshes: [7],
    cells: [
      {
        url: 'near.json',
        sha256: '',
        bytes: 1,
        parents: [near === null ? [null, [0, 0, 0, 5, 5, 5]] : [0, [0, -10, 0, 5, -5, 5]]],
        meshes: [[7, 2]],
      },
      {
        url: 'far.json',
        sha256: '',
        bytes: 1,
        // Under the core node, 10 m up, or at the same place under the root.
        parents: [
          far === null ? [null, [5000, 0, 0, 5010, 5, 5]] : [0, [5000, -10, 0, 5010, -5, 5]],
        ],
        meshes: [[7, 1]],
      },
    ],
  };
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
    base: 'https://cache.test/key/',
    root,
    parents: [core],
    meshes: new Map([[7, placedMesh(links)]]),
  });
  const bytes = (url: string) =>
    new TextEncoder().encode(JSON.stringify(bodies[url.split('/').at(-1)!]));
  return { cells, links, root, core, bytes, node };
}

/** An io that holds every cell already read, records what it is asked and each time the reach
 *  outgrew the rows. */
export function io(bytes: (url: string) => Uint8Array) {
  const asked: string[] = [],
    updates: [PlacementRows, number, number][] = [];
  const held = new Set<string>();
  const outgrown = { count: 0 };
  const port: PartitionIo = {
    bytes: (url) => (held.has(url) ? bytes(url) : undefined),
    loading: () => false,
    request: (urls) => void asked.push(...urls),
    update: (rows, from, to) => updates.push([rows, from, to]),
    outgrown: () => void outgrown.count++,
  };
  return { port, asked, updates, held, outgrown };
}

/** A reach past both cells. */
export const everywhere = 1e5;
/** Opens a session on `cells` for `reach` from far away, an owner to open it again unless
 *  `owned` is false: its rows are sized, no cell is read. */
export const opened = (cells: PartitionCells, reach: number, owned = true) =>
  cells.prime([1e9, 0, 0], reach, () => Promise.reject(new Error('nothing is read')), owned);
/** No arrival budget: what a test places never depends on the time the machine takes. */
export const noBudget = { admits: () => true, spend() {} };
export const row = (rows: PlacementRows, at: number) => [
  ...rows.matrices.subarray(at * 16, at * 16 + 16),
];
