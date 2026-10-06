import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { pose } from '../host/prepared/nodes.ts';
import { configurePageDecoders, patientTask, releasePageDecoders } from '../page/decode/host.ts';
import {
  NodeDomWorker,
  withNodeWorkerShim,
} from '../../../../bench/oracles/browser/pageDecodeNodeWorker.ts';
import { cellRows, decodeCellFile } from './cellDecode.ts';

const nodes = [
  { parent: null, mesh: 7, matrix: null, translation: [1, 2, 3], rotation: null, scale: [2, 2, 2] },
  { parent: 4, mesh: 9, matrix: null, translation: null, rotation: [0, 1, 0, 0], scale: null },
];
const text = JSON.stringify({ version: 2, nodes });

test('a cell file is read into each node its ranks and the local matrix a host node composes', () => {
  const rows = cellRows(decodeCellFile(new TextEncoder().encode(text).buffer));
  assert.deepEqual([rows.nodes, [...rows.ranks]], [2, [-1, 7, 4, 9]]);
  nodes.forEach((node, at) => {
    const host = new Object3D();
    pose(host, node);
    host.updateMatrix();
    const local = [...host.matrix.elements];
    assert.deepEqual([...rows.locals.subarray(16 * at, 16 * at + 16)], local, `node ${at}`);
  });
  const stale = new TextEncoder().encode(JSON.stringify({ version: 1, nodes })).buffer;
  assert.throws(() => decodeCellFile(stale), { code: 'INVALID_SCENE_TABLES' });
});

test('a cell file is parsed in a worker of the decode pool, never on the main thread', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    const parse = JSON.parse;
    let parsed = 0;
    JSON.parse = (...args: Parameters<typeof parse>) => {
      if (args[0] === text) parsed++;
      return parse(...args);
    };
    let answer;
    try {
      answer = await patientTask('cells', new TextEncoder().encode(text));
    } finally {
      JSON.parse = parse;
      releasePageDecoders();
    }
    assert.equal(parsed, 0, 'the main thread parsed the cell');
    assert.ok(answer.ok && answer.cells, JSON.stringify(answer));
    const here = decodeCellFile(new TextEncoder().encode(text).buffer);
    assert.deepEqual(new Float64Array(answer.cells.locals), new Float64Array(here.locals));
  }));

test('a cell file the worker refuses answers with its code and names its file', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    const stale = new TextEncoder().encode(JSON.stringify({ version: 1, nodes }));
    let answer;
    try {
      answer = await patientTask('cells', stale, 'https://cache.test/key/scene-cell-3.json');
    } finally {
      releasePageDecoders();
    }
    assert.ok(!answer.ok, 'refused');
    assert.equal(answer.refusal, 'INVALID_SCENE_TABLES');
    assert.match(answer.message, /scene-cell-3\.json/);
  }));
