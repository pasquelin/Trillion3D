import test from 'node:test';
import assert from 'node:assert/strict';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { preparedGraph } from './graph.ts';
import { preparedNodeRank, readPreparedSourceRank } from './sourceRanks.ts';

test('a renumbered core node keeps its original numeric source rank in the runtime graph', async () => {
  const tables = {
    scene: { name: '', nodes: [0] },
    nodes: [
      {
        name: 'retained parent',
        sourceNode: '00009000',
        children: [],
        mesh: null,
        light: null,
        camera: null,
        skin: null,
    skin: null,
        weights: null,
        matrix: null,
        translation: null,
        rotation: null,
        scale: null,
        visible: true,
      },
    ],
    skins: [],
    animations: [],
  } as unknown as PreparedSceneTables;
  const unused = () => {
    throw new Error('this node carries no mesh');
  };
  const { nodes } = await preparedGraph({
    tables,
    meshes: [],
    geometryOf: unused,
    materialOf: unused,
  });
  assert.equal(nodes.length, 1);
  assert.equal(preparedNodeRank(nodes[0]), 36864, 'not its compacted table rank zero');
});

test('fixed-width source ranks decode every u32 boundary and reject malformed encodings', () => {
  assert.equal(readPreparedSourceRank('00000000', 7), 0);
  assert.equal(readPreparedSourceRank('ffffffff', 7), 0xffffffff);
  assert.equal(readPreparedSourceRank(undefined, 7), 7);
  for (const value of [0, null, '', '09000', '000009000', 'FFFFFFFF', '0000900g', '-0000001'])
    assert.throws(() => readPreparedSourceRank(value, 7), /eight lowercase hexadecimal digits/);
});
