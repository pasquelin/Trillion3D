import test from 'node:test';
import assert from 'node:assert/strict';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createCellBoxes } from './boxes.ts';
import { createCellIndex } from './cellIndex.ts';
import { createPartitionCells } from './cells.ts';
import { io, noBudget, opened, settled } from './cells.fixture.ts';
import { openAll, paged, walked } from './paged.fixture.ts';
import { placedMesh, type RowLink } from './rows.ts';

/** A square world of `side` × `side` cells of 10 m, under the core node `rank` or the root, in
 *  the order the cook halves them (`split.rs`): its records and its cell files. */
function grid(side: number, rank: number | null = null) {
  const cells: TableCell[] = [];
  const files = new Map<string, Uint8Array>();
  const halve = (x: number, y: number, width: number, height: number) => {
    if (width * height > 1) {
      if (width >= height) [x, x + width / 2].forEach((at) => halve(at, y, width / 2, height));
      else [y, y + height / 2].forEach((at) => halve(x, at, width, height / 2));
      return;
    }
    const url = `cell-${x}-${y}.json`;
    const box = [10 * x, 10 * y, 0, 10 * x + 10, 10 * y + 10, 1];
    cells.push({
      url,
      sha256: '',
      bytes: 1,
      parents: [[rank, box]],
      meshes: [[0, 1]],
      meshPages: [],
    });
    const node = { parent: rank, mesh: 0, matrix: null, rotation: null, scale: null };
    const body = { version: 2, nodes: [{ ...node, translation: [10 * x + 5, 10 * y + 5, 0] }] };
    files.set(url, new TextEncoder().encode(JSON.stringify(body)));
  };
  halve(0, 0, side, side);
  return { cells, files };
}

test("a frame's cell work is the same on a world sixteen times as large", () => {
  // The same camera, 25 m from the corner cell of both worlds: 8 × 8 cells, then 32 × 32, in
  // region pages of four.
  const eye = [45, 45, 0.5];
  const walk = (side: number) => {
    const { index, found, tested } = walked(grid(side).cells, eye, 25);
    return { tested, found: found.length, opened: index.stats() };
  };
  const small = walk(8),
    large = walk(32);
  assert.equal(large.found, small.found, 'the same cells within reach');
  assert.equal(large.tested.cells, small.tested.cells, 'the same cells tested');
  // The pages met grow by the levels the larger world adds, never by its cells; the index holds
  // the region pages the camera reached, the same in both.
  assert.ok(large.tested.pages <= small.tested.pages + 2 * 4, JSON.stringify([small, large]));
  assert.equal(large.opened.cells, small.opened.cells, 'the cells of the region pages reached');
  assert.ok(large.opened.cells < (32 * 32) / 8, `${large.opened.cells} of ${32 * 32} cells held`);
});

/** The rows the cook lists for `grid`'s cells, one node each on a lattice of 10 m (`rows.rs`): a
 *  window of one and a half times a rung's side, at half its side, meets that many cells a side,
 *  and one more. */
const LATTICE = {
  cube: Math.hypot(10, 10, 1),
  rows: (_: number, total: number, rung: number) =>
    Math.min(total, (Math.ceil((1.5 * Math.hypot(10, 10, 1) * 2 ** (rung / 2)) / 10) + 1) ** 2),
};

test('before its first frame a partition reads what its camera reaches, alike at 1× and 16× the world', async () => {
  const eye = [45, 45, 0.5];
  const open = async (side: number) => {
    const { cells, files: bodies } = grid(side);
    const { partition, files, root } = paged(cells, 4, undefined, LATTICE);
    const link: RowLink = { meshes: 0, primitives: 0 };
    const partitioned = createPartitionCells({
      partition,
      base: 'https://cache.test/key/',
      root: new Group(),
      parents: [],
      meshes: new Map([[0, placedMesh([link])]]),
    });
    const read: string[] = [];
    const bytes = (url: string) => {
      const name = url.split('/').at(-1)!;
      read.push(name);
      return files.get(name) ?? bodies.get(name)!;
    };
    const primed = await opened(partitioned, bytes, 25, true, eye);
    const cellsRead = read.filter((name) => !name.startsWith('scene-page-'));
    const stats = partitioned.stats();
    return { stats, primed, cellsRead, rootBytes: JSON.stringify(root).length, link, read };
  };
  const [small, large] = [await open(16), await open(64)];
  assert.equal(small.rootBytes, large.rootBytes, 'one root, whatever the world');
  assert.deepEqual(
    large.cellsRead.sort(),
    small.cellsRead.sort(),
    'the same cells, read and placed',
  );
  assert.ok(large.stats.held > 0 && large.stats.held === small.stats.held, JSON.stringify(large));
  // The pages on the way grow by the levels the larger world adds, never by its cells.
  const pages = (world: typeof small) => world.read.length - world.cellsRead.length;
  assert.ok(pages(large) <= pages(small) + 2 * 4, JSON.stringify([pages(small), pages(large)]));
  // The rows the view holds, bound by it: the same in both worlds, a part of either.
  const rows = [small, large].map((world) => world.link.placements!.capacity);
  assert.equal(rows[0], rows[1], 'the same rows at 1× and 16× the world');
  assert.ok(rows[1] < 16 * 16, `${rows[1]} rows`);
});

test('pages the view left are closed, their files let go; those holding a placed cell stay', async () => {
  const { cells, files: bodies } = grid(16);
  const { partition, files } = paged(cells, 4);
  const partitioned = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root: new Group(),
    parents: [],
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
  });
  const port = io(
    (url) => files.get(url.split('/').at(-1)!) ?? bodies.get(url.split('/').at(-1)!)!,
  );
  cells.forEach(({ url }) => port.held.add(`https://cache.test/key/${url}`));
  await opened(partitioned, () => new Uint8Array(), 12, false, [1e9, 0, 0]);
  await settled(partitioned, [5, 5, 0.5], 12, port.port, noBudget);
  const near = partitioned.stats();
  await settled(partitioned, [155, 155, 0.5], 12, port.port, noBudget);
  const far = partitioned.stats();
  assert.equal(far.held, near.held, 'the cells around the camera, placed');
  assert.ok(port.forgotten.length > 0, 'the files of the pages closed leave the catalogue');
  assert.ok(far.cells <= 2 * near.cells, JSON.stringify([near, far]));
});

test('the index finds every cell a whole walk finds, under a parent moved and turned', () => {
  const { cells } = grid(16, 0);
  const root = new Group(),
    core = new Object3D();
  root.add(core);
  const { partition, files } = paged(cells, 4);
  const boxes = createCellBoxes([0], root, [core]);
  const index = createCellIndex(partition.pages, 'https://cache.test/', boxes);
  const poses = [
    () => {},
    () => core.position.set(-70, 30, 0),
    () => core.rotation.set(0, 0, 0.7),
    () => core.scale.set(0.5, 2, 1),
  ];
  const none = { has: () => false };
  for (const pose of poses) {
    pose();
    boxes.refresh();
    for (const [x, y, radius] of [
      [0, 0, 15],
      [60, -40, 40],
      [-30, 90, 5],
    ]) {
      const eye = [x, y, 0.5];
      openAll(index, files, eye, radius);
      const found: number[] = [];
      index.near(
        eye,
        radius,
        Infinity,
        none,
        (cell) => found.push(cell),
        () => {},
      );
      // Every cell of the world, opened whole on a second index: the walk finds the same.
      const whole = createCellIndex(partition.pages, 'https://cache.test/', boxes);
      openAll(whole, files);
      const all = [...Array(whole.stats().cells).keys()]
        .filter((cell) => whole.distance(cell, eye) <= radius)
        .map((cell) => whole.cell(cell).url);
      const urls = found.map((cell) => index.cell(cell).url);
      assert.deepEqual(urls.sort(), all.sort(), `eye ${eye}, reach ${radius}`);
    }
  }
});
