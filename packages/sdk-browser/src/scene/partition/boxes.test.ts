import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphGroup } from '../../host/graph/mesh.ts';
import { GraphNode } from '../../host/graph/node.ts';
import { createCellBoxes } from './boxes.ts';
import { createPartitionCells } from './cells.ts';
import { placedMesh } from './rows.ts';

/** A cell of one node at the origin of the root, and one 5 km off under a core node. */
function world() {
  const node = (parent: number | null) => ({
    parent,
    mesh: 0,
    matrix: null,
    translation: [5000 * (parent === null ? 0 : 1), 0, 0],
    rotation: null,
    scale: null,
  });
  const cells = [
    { url: 'near.json', sha256: '', bytes: 1, meshes: [[0, 1] as const] },
    { url: 'far.json', sha256: '', bytes: 1, meshes: [[0, 1] as const] },
  ];
  const partition = {
    version: 1,
    bounds: [0, 0, 0, 5001, 1, 1],
    meshes: [0],
    cells: [
      { ...cells[0], parents: [[null, [0, 0, 0, 1, 1, 1]] as const] },
      { ...cells[1], parents: [[0, [5000, 0, 0, 5001, 1, 1]] as const] },
    ],
  };
  const root = new GraphGroup();
  const core = new GraphNode();
  root.add(core);
  const body = (url: string) =>
    new TextEncoder().encode(
      JSON.stringify({ version: 1, nodes: [node(url.endsWith('near.json') ? null : 0)] }),
    );
  const partitioned = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root,
    parents: [core],
    meshes: new Map([[0, placedMesh([{ meshes: 0 }])]]),
  });
  return { partition, root, core, partitioned, body };
}

test("a cell's box follows its core parent, turned and moved, and the root's frame", () => {
  const { partition, root, core } = world();
  const boxes = createCellBoxes(partition.cells, root, [core]);
  assert.deepEqual([...boxes()[1].bounds], [5000, 0, 0, 5001, 1, 1]);
  core.position.set(-5000, 0, 0);
  assert.deepEqual([...boxes()[1].bounds], [0, 0, 0, 1, 1, 1]);
  root.position.set(100, 0, 0); // the root carries both: nothing moves in its frame
  assert.deepEqual([...boxes()[1].bounds], [0, 0, 0, 1, 1, 1]);
  assert.deepEqual([...boxes()[0].bounds], [0, 0, 0, 1, 1, 1]);
});

test('parents moved so close that a cell is short of rows ask the owner once, then fit', async () => {
  const { core, partitioned, body } = world();
  const read = async (url: string) => body(url);
  let asked = 0;
  const port = { bytes: body, loading: () => false, request() {}, update() {} };
  const step = () =>
    partitioned.frame([0, 0, 0], 100, { ...port, outgrown: () => void asked++ }, Infinity);
  await partitioned.prime([0, 0, 0], 100, read, true);
  assert.equal(partitioned.stats().rows, 1, 'one node within 100 m of any other');
  core.position.set(-5000, 0, 0);
  step();
  step();
  assert.deepEqual([partitioned.stats().waiting, asked], [1, 1]);
  // Opened again, the rows are sized on where the cells stand now.
  await partitioned.prime([0, 0, 0], 100, read, true);
  step();
  assert.deepEqual([partitioned.stats().held, partitioned.stats().waiting, asked], [2, 0, 1]);
});
