// The resident proxy file (#957): shapes the compiler stored once come back as the flat proxy it
// simplified, triangle for triangle at their positions, and a file that places a triangle twice or
// names a shape it lacks is refused before any ray reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type SceneProxyDescriptor,
} from '../../contracts/proxy.ts';
import { decodeSceneProxy } from './proxy.ts';

/** One shape triangle, and a loose one no shape carries. */
const SHAPE = [0, 0, 0, 1, 0, 0, 0, 2, 0.1];
const LOOSE = [7, 7, 7, 8, 7, 7, 7, 8, 7];
/** Row-major 3×4 maps: the identity moved by (4, 0, 0), and a mirror in x moved by (9, 0, 0). */
const MOVED = [1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 1, 0];
const MIRRORED = [-1, 0, 0, 9, 0, 1, 0, 0, 0, 0, 1, 0];

/** A three-triangle file: the shape placed by both maps at `positions`, the loose one in the gap. */
function file(positions: number[], shapeOf = [0, 0]) {
  const f = (values: number[]) => Array.from(new Uint32Array(new Float32Array(values).buffer));
  const words = [
    ...[SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION, 3, 0, 1, 1, shapeOf.length],
    ...[1, ...f(SHAPE), 0xff0000ff],
    ...[...shapeOf, ...f([...MOVED, ...MIRRORED]), ...positions],
    ...[...f(LOOSE), 0xff00ff00],
  ];
  const buffer = new Uint32Array(words).buffer;
  const descriptor: SceneProxyDescriptor = {
    ...{ version: SCENE_PROXY_VERSION, url: 'proxy.bin', sha256: 'x', bytes: buffer.byteLength },
    ...{ errorMetres: 0, errorFloorMetres: 0, cellMetres: 1, triangleBudget: 3 },
    ...{ bounds: [0, 0, 0, 9, 8, 7], triangles: 3, nodes: 0 },
  };
  return () => decodeSceneProxy(descriptor, buffer);
}

test('shared shapes expand to the flat proxy, placed by their maps at their positions', () => {
  const { data } = file([2, 0])();
  const z = Math.fround(0.1);
  const mirrored = [9, 0, 0, 8, 0, 0, 9, 2, z],
    moved = [4, 0, 0, 5, 0, 0, 4, 2, z];
  assert.deepEqual(Array.from(data.triangles), [...mirrored, ...LOOSE, ...moved]);
  assert.deepEqual(Array.from(data.albedo), [0xff0000ff, 0xff00ff00, 0xff0000ff]);
});

test('a file that places a triangle twice, or names a shape it lacks, is refused', () => {
  assert.throws(file([1, 1]), /places a triangle twice or nowhere/);
  assert.throws(file([1, 3]), /places a triangle twice or nowhere/);
  assert.throws(file([1, 0], [0, 1]), /names a shape it does not have/);
});
