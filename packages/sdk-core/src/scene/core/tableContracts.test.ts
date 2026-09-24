import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSceneTables } from './tableContracts.ts';
import { assertCellNodes } from './tablePartition.ts';

const hasCode =
  (code: string, text = '') =>
  (error: unknown) =>
    (error as { code?: string }).code === code && (error as Error).message.includes(text);

/** Tables at the versions this runtime reads, every table empty. */
const tables = () => ({
  version: 3,
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

test('a partition of another version is refused, and a cell is read only at its own', () => {
  const partition = { version: 1, bounds: [], meshes: [], cells: [] };
  assert.deepEqual(assertSceneTables({ ...tables(), partition }).partition, partition);
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, version: 2 } }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'partition version 2'),
  );
  assert.deepEqual(assertCellNodes({ version: 1, nodes: [] }), []);
  assert.throws(() => assertCellNodes({ version: 2, nodes: [] }), hasCode('INVALID_SCENE_TABLES'));
});
