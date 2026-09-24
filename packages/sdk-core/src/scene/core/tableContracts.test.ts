import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSceneTables } from './tableContracts.ts';

const hasCode =
  (code: string, text = '') =>
  (error: unknown) =>
    (error as { code?: string }).code === code && (error as Error).message.includes(text);

/** Tables at the versions this runtime reads, every table empty. */
const tables = () => ({
  version: 2,
  nodeTableVersion: 2,
  materialTableVersion: 4,
  geometryTableVersion: 1,
  scene: { name: null, nodes: [] },
  nodes: [],
  lights: [],
  cameras: [],
  materials: [],
  textures: [],
  documents: {},
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
  assert.throws(() => assertSceneTables(null), hasCode('INVALID_SCENE_TABLES'));
});
