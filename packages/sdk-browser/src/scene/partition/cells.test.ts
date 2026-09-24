import test from 'node:test';
import assert from 'node:assert/strict';
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { GraphGroup } from '../../host/graph/mesh.ts';
import { GraphNode } from '../../host/graph/node.ts';
import { pose } from '../../host/prepared/nodes.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { createPartitionCells, type PartitionCells } from './cells.ts';

type PartitionIo = Parameters<PartitionCells['frame']>[2];
import { placedMesh, type RowLink } from './rows.ts';

/** Two cells of one mesh, one near the origin and one 5 km away; the second hangs under a moved
 *  core node. */
function world() {
  const node = (x: number, parent: number | null) => ({
    parent,
    mesh: 7,
    matrix: null,
    translation: [x, 1, 2],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    scale: [2, 2, 2],
  });
  const bodies: Record<string, unknown> = {
    'near.json': { version: 1, nodes: [node(1, null), node(3, null)] },
    'far.json': { version: 1, nodes: [node(5000, 0)] },
  };
  const partition: TablePartition = {
    version: 1,
    bounds: [0, 0, 0, 5010, 5, 5],
    meshes: [7],
    cells: [
      { url: 'near.json', sha256: '', bytes: 1, bounds: [0, 0, 0, 5, 5, 5], size: 3, nodes: 2 },
      {
        url: 'far.json',
        sha256: '',
        bytes: 1,
        bounds: [5000, 0, 0, 5010, 5, 5],
        size: 3,
        nodes: 1,
      },
    ],
  };
  const root = new GraphGroup();
  const core = new GraphNode();
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

/** An io that holds every cell already read, records what it is asked, and grows in place. */
function io(bytes: (url: string) => Uint8Array, grows = true) {
  const asked: string[] = [],
    updates: [PlacementRows, number, number][] = [],
    grown: PlacementRows[] = [];
  const held = new Set<string>();
  const port: PartitionIo = {
    bytes: (url) => (held.has(url) ? bytes(url) : undefined),
    loading: () => false,
    request: (urls) => void asked.push(...urls),
    update: (rows, from, to) => updates.push([rows, from, to]),
    ...(grows ? { grow: (_from: PlacementRows, to: PlacementRows) => void grown.push(to) } : {}),
  };
  return { port, asked, updates, grown, held };
}

const everywhere = () => Infinity;
const row = (rows: PlacementRows, at: number) => [...rows.matrices.subarray(at * 16, at * 16 + 16)];

test('the cells a camera needs are asked nearest first, then placed on rows once read', () => {
  const { cells, links, bytes } = world();
  const { port, asked, updates, held } = io(bytes);
  cells.frame([6000, 0, 0], everywhere, port, 2);
  assert.deepEqual(asked, ['https://cache.test/key/far.json', 'https://cache.test/key/near.json']);
  assert.deepEqual(cells.stats(), { cells: 2, held: 0, waiting: 0 });
  asked.forEach((url) => held.add(url));
  cells.frame([6000, 0, 0], everywhere, port, 2);
  assert.equal(cells.stats().held, 2);
  for (const link of links) assert.deepEqual([...link.placements!.live], [1, 1, 1]);
  assert.ok(updates.length >= 2, 'the session is told which rows were written');
});

test('a row holds the world matrix the engine composes for the same node under its parent', () => {
  const { cells, links, core, bytes, node } = world();
  const { port, held } = io(bytes);
  ['near.json', 'far.json'].forEach((name) => held.add(`https://cache.test/key/${name}`));
  cells.frame([0, 0, 0], everywhere, port, 2);
  const child = new GraphNode();
  pose(child, node(5000, 0));
  core.add(child);
  const expected = [...hostWorldChainInto(new Float64Array(16), child)];
  const rows = links[1].placements!;
  const at = [0, 1, 2].find((index) => row(rows, index)[12] === expected[12])!;
  assert.deepEqual(row(rows, at), expected, 'the same bits as a host node there');
  // The parent moves: the rows under it follow before the next frame.
  core.position.set(0, 20, 0);
  cells.frame([0, 0, 0], everywhere, port, 2);
  assert.deepEqual(row(rows, at), [...hostWorldChainInto(new Float64Array(16), child)]);
});

test('a cell past its reach gives its rows back, parked, for the next cell to take', () => {
  const { cells, links, bytes } = world();
  const { port, held, updates } = io(bytes);
  ['near.json', 'far.json'].forEach((name) => held.add(`https://cache.test/key/${name}`));
  cells.frame([0, 0, 0], everywhere, port, 2);
  updates.length = 0;
  cells.frame([0, 0, 0], () => 100, port, 2);
  assert.equal(cells.stats().held, 1, 'the far cell left');
  const live = links[0].placements!.live;
  assert.equal(
    live.reduce((sum, flag) => sum + flag, 0),
    2,
  );
  assert.ok(updates.length, 'the parked row is sent');
});

test('rows grow through the session, and a session that cannot grow them keeps the cell waiting', () => {
  const grown = world();
  const growing = io(grown.bytes);
  growing.held.add('https://cache.test/key/near.json');
  grown.cells.frame([0, 0, 0], () => 100, growing.port, 2);
  assert.equal(growing.grown.length, 2, 'one buffer per primitive, grown together');
  const fixed = world();
  const still = io(fixed.bytes, false);
  still.held.add('https://cache.test/key/near.json');
  fixed.cells.frame([0, 0, 0], () => 100, still.port, 2);
  assert.deepEqual(fixed.cells.stats(), { cells: 2, held: 0, waiting: 1 });
});

test('a world that poses the scene root reads the cells its camera sees there', () => {
  // The far cell stands at the world's origin once the root is moved back 5 km and shrunk ten
  // times: a camera there asks for it, and not for the near cell, now 500 m away.
  const { cells, root, bytes } = world();
  root.position.set(-500, 0, 0);
  root.scale.set(0.1, 0.1, 0.1);
  const { port, asked } = io(bytes);
  cells.frame([2, 0, 0], () => 100, port, 2);
  assert.deepEqual(asked, ['https://cache.test/key/far.json']);
});
