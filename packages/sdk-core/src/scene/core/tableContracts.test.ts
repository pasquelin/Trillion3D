import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSceneTables, readSceneTables } from './tableContracts.ts';
import { assertCellNodes, type TablePage } from './tablePartition.ts';

const hasCode =
  (code: string, text = '') =>
  (error: unknown) =>
    (error as { code?: string }).code === code && (error as Error).message.includes(text);

/** Tables at the versions this runtime reads, every table empty. */
const tables = () => ({
  version: 4,
  nodeTableVersion: 3,
  materialTableVersion: 4,
  geometryTableVersion: 1,
  scene: { name: null, nodes: [] },
  nodes: [],
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

/** The bits of `value` as sixteen hexadecimal digits, as the compiler writes a slot's box. */
function bitsOf(value: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}
/** A slot naming the page whose digest ends in `digest`, of `bytes` bytes, boxed by `box`. */
const slot = (digest: string, bytes: number, box: number[]) =>
  digest.padStart(64, '0') + bytes.toString(16).padStart(8, '0') + box.map(bitsOf).join('');
const EMPTY = '0'.repeat(64 + 8 + 96);
const cell = (url: string, mesh: number) => ({
  url,
  sha256: '',
  bytes: 1,
  parents: [],
  meshes: [[mesh, 1]],
});

test('a partition root of another version or shape is refused, and a cell is read only at its own', () => {
  const partition = { version: 2, pages: Array(8).fill(EMPTY) };
  assert.deepEqual(assertSceneTables({ ...tables(), partition }).partition, partition);
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, version: 1 } }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'partition version 1'),
  );
  // A root is a fixed number of slots: fewer is not a root this runtime reads.
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, pages: [EMPTY] } }),
    hasCode('INVALID_SCENE_TABLES'),
  );
  assert.deepEqual(assertCellNodes({ version: 2, nodes: [] }), []);
  assert.throws(() => assertCellNodes({ version: 1, nodes: [] }), hasCode('INVALID_SCENE_TABLES'));
});

test('the pages under the root give back every cell in order, the box around them and their meshes', async () => {
  // The root names an index page and a region page; the index page names two region pages.
  const bodies: Record<string, unknown> = {
    a: { version: 2, pages: [slot('c', 1, [0, 0, 0, 1, 1, 1]), slot('d', 1, [1, 0, 0, 2, 1, 1])] },
    b: { version: 2, cells: [cell('scene-cell-3.json', 7)] },
    c: { version: 2, cells: [cell('scene-cell-0.json', 4), cell('scene-cell-1.json', 7)] },
    d: { version: 2, cells: [cell('scene-cell-2.json', 4)] },
  };
  const read = async ({ sha256, url }: TablePage) => {
    assert.equal(url, `scene-page-${sha256}.json`);
    return new TextEncoder().encode(JSON.stringify(bodies[sha256.replace(/^0+/, '')]));
  };
  const pages = [slot('a', 1, [0, 0, 0, 2, 1, 1]), slot('b', 1, [-3, 0, 0, -2, 5, 1])];
  const partition = { version: 2, pages: [...pages, ...Array(6).fill(EMPTY)] };
  const file = assertSceneTables({ ...tables(), partition });
  const paged = (await readSceneTables(file, read)).partition!;
  assert.deepEqual(
    paged.cells.map((one) => one.url),
    ['scene-cell-0.json', 'scene-cell-1.json', 'scene-cell-2.json', 'scene-cell-3.json'],
  );
  assert.deepEqual(paged.bounds, [-3, 0, 0, 2, 5, 1]);
  assert.deepEqual(paged.meshes, [4, 7]);
  // A slot that is not fixed-width hexadecimal, or a page of another version, is refused.
  const bad = { version: 2, pages: ['z'.repeat(168), ...Array(7).fill(EMPTY)] };
  await assert.rejects(
    readSceneTables(assertSceneTables({ ...tables(), partition: bad }), read),
    hasCode('INVALID_SCENE_TABLES'),
  );
  bodies.b = { version: 1, cells: [] };
  await assert.rejects(
    readSceneTables(file, read),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'version 1'),
  );
});
