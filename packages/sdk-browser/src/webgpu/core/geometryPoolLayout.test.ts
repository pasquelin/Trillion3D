// #1410: the shadow receiver offset reads the float pool's positions and normals through one
// binding, so the deferred lighting holds its storage buffers within the eight WebGPU guarantees.
// The normals ride in the position buffer, past the positions and the deformation block, at a
// binding offset. Defects these tests catch: a normal written where the receiver does not read it
// (its `vertN` then shades another normal than the resolve's), ranges that overlap (the deformation
// stage, which writes the positions and reads the normals, is refused), a growth that leaves the
// normals behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { vertNormalWgsl } from '../../visibility/shader/pageWgsl.ts';
import { createVertexPool } from './geometryPool.ts';
import type { HostAttributes } from '../../host/resources.ts';

/** A triangle whose every normal and tangent component differs. */
function triangle() {
  const geometry = new G.Geometry();
  geometry.setAttribute('position', G.floatAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute(
    'normal',
    G.floatAttribute([0.1, 0.2, 0.9, 0.3, 0.4, 0.8, 0.5, 0.6, 0.7], 3),
  );
  geometry.setAttribute('tangent', G.floatAttribute([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 4));
  return geometry.attributes as unknown as HostAttributes;
}
const TAIL = 5;
type Vertex = { vertN: (base: number, idx: number) => number[] };

test('the receiver reads, past the positions, the very normals the resolve reads from its range', () => {
  const { device, writes } = fakeDevice();
  const pool = createVertexPool(device, 6, false, new Map(), TAIL);
  const first = triangle(),
    second = triangle();
  pool.place(first);
  const block = pool.place(second)!;
  const { positions, concatNrm, normalBase, concatPos } = pool;
  assert.equal(normalBase % 64, 0, 'the normals start at a binding offset');
  assert.ok(normalBase >= 6 * 3 + TAIL, 'past the positions and the deformation block');
  assert.deepEqual(
    [positions.buffer, positions.offset, positions.size],
    [concatPos, 0, normalBase * 4],
  );
  assert.deepEqual(
    [concatNrm.buffer, concatNrm.offset, concatNrm.size],
    [concatPos, normalBase * 4, 6 * 28],
    'the normals: a range of their own, after the positions, never over them',
  );
  const bytes = new ArrayBuffer(concatPos.size);
  replayWrites(
    bytes,
    writes.filter((write) => write.buffer === concatPos),
  );
  const whole = new Float32Array(bytes),
    range = whole.subarray(normalBase);
  const resolve = shaderRun<Vertex>(vertNormalWgsl(), ['vertN'], { normals: range });
  const receiver = shaderRun<Vertex>(vertNormalWgsl('positions', 'uni.normalBase+'), ['vertN'], {
    positions: whole,
    uni: { normalBase },
  });
  for (let vertex = 0; vertex < 3; vertex++) {
    const read = resolve.vertN(block.vertexBase, vertex);
    assert.deepEqual(receiver.vertN(block.vertexBase, vertex), read, `vertex ${vertex}`);
    assert.deepEqual(
      read.map((v) => Math.fround(v)),
      Array.from(range.subarray(21 + vertex * 7, 24 + vertex * 7)),
    );
  }
  assert.ok(
    receiver.vertN(block.vertexBase, 1).some((v) => v !== 0),
    'a normal was written',
  );
  assert.equal(vertNormalWgsl(), vertNormalWgsl('normals', ''), 'the passes read as before');
});

test('a growth carries the normals to where the wider buffer keeps them', () => {
  const { device, copies } = fakeDevice();
  const pool = createVertexPool(device, 3, false, new Map(), TAIL);
  pool.place(triangle());
  const [before, base] = [pool.concatPos, pool.normalBase];
  pool.place(triangle()); // past the room: the pool doubles
  const after = pool.concatPos;
  assert.notEqual(after, before, 'a wider buffer');
  const moved = copies.filter(({ from, to }) => from === before && to === after);
  assert.deepEqual(
    moved.map(({ fromOffset, toOffset, size }) => [fromOffset, toOffset, size]),
    [
      [0, 0, 3 * 12],
      [3 * 12, 6 * 12, TAIL * 4],
      [base * 4, pool.normalBase * 4, 3 * 28],
    ],
    'the positions, the deformation block after the wider room, then the normals',
  );
  assert.equal(pool.concatNrm.offset, pool.normalBase * 4, 'the range follows the growth');
});
