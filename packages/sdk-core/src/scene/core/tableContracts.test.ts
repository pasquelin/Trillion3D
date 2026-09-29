import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSceneTables } from './tableContracts.ts';
import { assertCellNodes } from './tableCell.ts';
import { readCellPage, tablePartition } from './tablePartition.ts';

const hasCode =
  (code: string, text = '') =>
  (error: unknown) =>
    (error as { code?: string }).code === code && (error as Error).message.includes(text);

/** Tables at the versions this runtime reads, every table empty. */
const tables = () => ({
  version: 5,
  nodeTableVersion: 4,
  materialTableVersion: 4,
  geometryTableVersion: 1,
  scene: { name: null, nodes: [] },
  nodes: [],
  meshPages: [],
  lights: [],
  cameras: [],
  materials: [],
  textures: [],
  documents: {},
  partition: null,
});

test('tables of an unknown version are refused rather than half-read', () => {
  assert.doesNotThrow(() => assertSceneTables(tables()));
  for (const field of ['version', 'nodeTableVersion', 'materialTableVersion'] as const)
    assert.throws(
      () => assertSceneTables({ ...tables(), [field]: 1 }),
      hasCode('UNSUPPORTED_SCENE_TABLES', `${field} 1`),
    );
  // #519: a node table of version 3 says no node's visibility; it is refused, never read visible.
  assert.throws(
    () => assertSceneTables({ ...tables(), nodeTableVersion: 3 }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'nodeTableVersion 3'),
  );
  assert.throws(
    () => assertSceneTables({ ...tables(), geometryTableVersion: 99 }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'geometryTableVersion 99'),
  );
  // Issue #275: the refusal says what to do — recompile the cache, and with which command.
  assert.throws(
    () => assertSceneTables({ ...tables(), materialTableVersion: 3 }),
    hasCode(
      'UNSUPPORTED_SCENE_TABLES',
      'recompile it with this one (pnpm run build:native, then trillion3d-compiler',
    ),
  );
  assert.throws(() => assertSceneTables(null), hasCode('INVALID_SCENE_TABLES'));
});

/** A slot naming the page whose digest ends in `digest`, boxed by `box`, as the compiler writes it. */
function slot(digest: string, box: number[]) {
  const bits = new DataView(new ArrayBuffer(8));
  const hex = (value: number) => (bits.setFloat64(0, value), bits.getBigUint64(0).toString(16));
  return `${digest.padStart(64, '0')}00000001${box.map((v) => hex(v).padStart(16, '0')).join('')}`;
}
const EMPTY = '0'.repeat(168);
const cells = (...ranks: number[]) =>
  ranks.map((at) => ({ url: `${at}`, parents: [], meshes: [[at, 1]] }));

test('a partition root of another version or shape is refused, and a cell is read only at its own', () => {
  const partition = { version: 4, pages: Array(8).fill(EMPTY), meshes: [], parents: [] };
  assert.deepEqual(assertSceneTables({ ...tables(), partition }).partition, partition);
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, version: 3 } }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'partition version 3'),
  );
  // The totals a root carries are fixed-width hexadecimal (#575).
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, meshes: [7] } }),
    hasCode('INVALID_SCENE_TABLES'),
  );
  // A root is a fixed number of slots: fewer is not a root this runtime reads.
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, pages: [EMPTY] } }),
    hasCode('INVALID_SCENE_TABLES'),
  );
  assert.deepEqual(assertCellNodes({ version: 2, nodes: [] }), []);
  assert.throws(() => assertCellNodes({ version: 1, nodes: [] }), hasCode('INVALID_SCENE_TABLES'));
});

test('the root gives its slots, box, totals and parents; a page is read alone, checked', () => {
  // The root names an index page `a` and a region page `b`; `a` names the region pages `c`, `d`.
  const [m, n] = [slot('e', [0, 0, 0, 0, 0, 0]), slot('f', [0, 0, 0, 0, 0, 0])];
  const [a, b] = [slot('a', [0, 0, 0, 2, 1, 1]), slot('b', [-3, 0, 0, -2, 5, 1])];
  const meshes = ['0000000000000002', '0000000300000011'];
  const root = {
    version: 4,
    pages: [a, b, ...Array(6).fill(EMPTY)],
    meshes,
    parents: ['0000000a'],
  };
  const partition = tablePartition(root);
  assert.deepEqual(partition.bounds, [-3, 0, 0, 2, 5, 1]);
  assert.deepEqual(
    [partition.meshes, [...partition.totals]],
    [
      [0, 3],
      [
        [0, 2],
        [3, 17],
      ],
    ],
  );
  assert.deepEqual(partition.parents, [10]);
  assert.deepEqual(
    partition.pages.map(({ page }) => page.url),
    ['a', 'b'].map((digest) => `scene-page-${digest.padStart(64, '0')}.json`),
  );
  const read = (body: unknown) => readCellPage(new TextEncoder().encode(JSON.stringify(body)), 'p');
  const index = read({ version: 4, pages: [slot('c', [0, 0, 0, 1, 1, 1]), EMPTY] });
  assert.deepEqual(
    [index.pages!.map(({ bounds }) => bounds), index.cells],
    [[[0, 0, 0, 1, 1, 1]], null],
  );
  const region = read({ version: 4, cells: cells(0, 1), meshPages: [m, n] });
  assert.deepEqual(
    region.cells!.map(({ url, meshPages }) => [url, meshPages]),
    [
      ['0', [m, n]],
      ['1', [m, n]],
    ],
  );
  // A page of another version, of neither pages nor cells, or naming a mesh page that is no slot,
  // is refused.
  assert.throws(
    () => read({ version: 3, cells: [] }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'version 3'),
  );
  assert.throws(() => read({ version: 4 }), hasCode('INVALID_SCENE_TABLES'));
  const badSlot = { version: 4, cells: cells(3), meshPages: ['e'] };
  assert.throws(() => read(badSlot), hasCode('INVALID_SCENE_TABLES', 'mesh pages'));
  assert.throws(
    () => read({ version: 4, pages: ['z'.repeat(168)] }),
    hasCode('INVALID_SCENE_TABLES'),
  );
});
