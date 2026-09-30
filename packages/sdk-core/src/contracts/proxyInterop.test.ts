import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeSceneProxy } from '../scene/core/proxy.ts';

test('proxy word layout decodes the compiler fixture into its independently emitted flat columns', () => {
  const bytes = Uint8Array.from(
    readFileSync(new URL('../scene/core/fixtures/proxy-v4.bin', import.meta.url)),
  );
  const header = new Uint32Array(bytes.buffer);
  const result = decodeSceneProxy(
    {
      version: 4,
      url: 'proxy.bin',
      sha256: 'fixture',
      bytes: bytes.length,
      errorMetres: 0,
      errorFloorMetres: 0,
      cellMetres: 1,
      triangleBudget: 1000,
      triangles: header[2],
      nodes: header[3],
      groups: header[4],
      owners: header[5],
      instances: header[6],
      bounds: [0, 0, 0, 1, 1, 1],
    },
    bytes.buffer,
  );
  const flat = readFileSync(new URL('../scene/core/fixtures/proxy-flat.bin', import.meta.url));
  const columns = [
    result.data.triangles,
    result.data.albedo,
    result.data.nodeBounds,
    result.data.nodeChildren,
    result.data.triangleGroups,
    result.data.groupOffsets,
    result.data.owners,
    result.data.sourceParents,
    result.data.bindWorlds,
  ];
  const actual = columns.flatMap((column) => [
    ...new Uint8Array(column.buffer, column.byteOffset, column.byteLength),
  ]);
  assert.deepEqual(actual, [...flat.subarray(32)]);
});
