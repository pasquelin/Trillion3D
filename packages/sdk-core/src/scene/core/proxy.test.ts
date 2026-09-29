// The resident proxy file (#957): the compiler's shared file comes back as the flat proxy it
// simplified, bit for bit, and a file that places a triangle twice or names a shape it lacks is
// refused before any ray reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type SceneProxyDescriptor,
} from '../../contracts/proxy.ts';
import { decodeSceneProxy } from './proxy.ts';

const decode = (buffer: ArrayBuffer) => {
  const [, , triangles, nodes, groups, owners, instances] = new Uint32Array(buffer, 0, 7);
  const descriptor: SceneProxyDescriptor = {
    ...{ version: SCENE_PROXY_VERSION, url: 'proxy.bin', sha256: 'x', bytes: buffer.byteLength },
    ...{ errorMetres: 0, errorFloorMetres: 0, cellMetres: 1, triangleBudget: 1, triangles, nodes },
    groups,
    owners,
    instances,
    bounds: [0, 0, 0, 1, 1, 1],
  };
  return decodeSceneProxy(descriptor, buffer);
};
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url))).buffer;

test('the compiler’s shared file expands to its flat file, word for word', () => {
  // Both written by `proxy::encode::tests` in the compiler: 60 copies of one triangle, some
  // turned, mirrored or off the grid, and the eighth turns that stay flat.
  const { data } = decode(fixture('proxy-v4.bin'));
  const flat = new Uint32Array(fixture('proxy-flat.bin'));
  const columns = [
    data.triangles,
    data.albedo,
    data.nodeBounds,
    data.nodeChildren,
    data.triangleGroups,
    data.groupOffsets,
    data.owners,
    data.sourceParents,
    data.bindWorlds,
  ];
  const actual = columns.flatMap((column) =>
    Array.from(new Uint8Array(column.buffer, column.byteOffset, column.byteLength)),
  );
  assert.deepEqual(actual, Array.from(new Uint8Array(flat.buffer, 32)));
});

/** One shape triangle placed twice at `positions`, and one loose triangle in the gap. */
function file(positions: number[], shapeOf = [0, 0]) {
  const f = (values: number[]) => Array.from(new Uint32Array(new Float32Array(values).buffer));
  const map = f([1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 1, 0]);
  const words = [
    ...[SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION, 3, 0, 1, 1, 1, 0, 1, 1, shapeOf.length, 1],
    ...[...f([0, 0, 0, 1, 0, 0, 0, 1, 0]), 1, ...shapeOf, ...map, ...map, ...positions],
    ...[...f([7, 7, 7, 8, 7, 7, 7, 8, 7]), 2],
    ...[0, 0, 0, 0, 1, 0, 1, 0xffffffff],
    ...new Uint32Array(new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).buffer),
  ];
  return () => decode(new Uint32Array(words).buffer);
}

test('a file that places a triangle twice, or names a shape it lacks, is refused', () => {
  assert.doesNotThrow(file([2, 0]));
  assert.throws(file([1, 1]), /places a triangle twice or nowhere/);
  assert.throws(file([1, 3]), /places a triangle twice or nowhere/);
  assert.throws(file([1, 0], [0, 1]), /names a shape it does not have/);
});

test('shared headers, empty shapes and nonfinite maps are refused before expansion', () => {
  const reject = (corrupt: (words: Uint32Array) => void, reason: RegExp) => {
    const buffer = fixture('proxy-v4.bin');
    corrupt(new Uint32Array(buffer));
    assert.throws(() => decode(buffer), reason);
  };
  reject((words) => {
    words[8] = 0xffffffff;
  }, /length/);
  reject((words) => {
    words[11] = 0;
  }, /shape is empty/);
  reject((words) => {
    const maps = 11 + words[8] + words[9] * 10 + words[10];
    words[maps] = 0x7fc00000;
  }, /map is non-finite/);
  reject((words) => {
    words[1] = 3;
  }, /disagrees with its manifest/);
});
