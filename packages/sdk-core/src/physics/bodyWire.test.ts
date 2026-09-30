import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter } from './commands.ts';
import { SHAPE } from './layout.ts';
import type { BodyRecord } from './bodyRecord.ts';

const body: BodyRecord = {
  id: 19,
  motion: 1,
  layer: 2,
  shape: SHAPE.box,
  flags: 7,
  position: [1, 2, 3],
  quaternion: [0, 0, 0, 1],
  size: [2, 3, 4],
  mass: 5,
  density: 6,
  friction: 0.25,
  restitution: 0.5,
  gravityScale: 1,
};

test('ADD preserves compound parts, mass frames and the following body', () => {
  const writer = new CommandWriter();
  writer.add({
    ...body,
    shape: SHAPE.compound,
    massFrame: [31, 32, 33],
    parts: [
      { shape: SHAPE.box, size: [2, 3, 4], position: [5, 6, 7], quaternion: [0, 0, 0, 1] },
      { shape: SHAPE.sphere, size: [8, 0, 0], position: [9, 10, 11], quaternion: [0, 1, 0, 0] },
    ],
  });
  writer.add(body);
  const words = writer.take(),
    floats = new Float32Array(words.buffer);
  assert.equal(words.length, 75);
  assert.deepEqual([...words.slice(23, 25)], [0, 25]);
  assert.equal(words[25], SHAPE.box);
  assert.deepEqual([...floats.slice(26, 36)], [2, 3, 4, 5, 6, 7, 0, 0, 0, 1]);
  assert.equal(words[36], SHAPE.sphere);
  assert.deepEqual([...floats.slice(37, 50)], [8, 0, 0, 9, 10, 11, 0, 1, 0, 0, 31, 32, 33]);
  assert.equal(words[51], 19);
  assert.deepEqual([...floats.slice(71, 73)], [Math.fround(0.05), Math.fround(0.05)]);
});

test('large indexed meshes retain their mass frame after all vertex and index data', () => {
  const writer = new CommandWriter();
  const vertices = Float32Array.from({ length: 1200 }, (_, i) => i + 0.5);
  const indices = Uint32Array.from({ length: 1800 }, (_, i) => i % 400);
  writer.add({ ...body, shape: SHAPE.triangles, vertices, indices, massFrame: [21, 22, 23] });
  writer.add(body);
  const words = writer.take(),
    floats = new Float32Array(words.buffer);
  assert.equal(words.length, 3053);
  assert.deepEqual([...words.slice(23, 25)], [400, 1803]);
  assert.deepEqual(floats.slice(25, 1225), vertices);
  assert.deepEqual(words.slice(1225, 3025), indices);
  assert.deepEqual([...floats.slice(3025, 3028)], [21, 22, 23]);
  assert.equal(words[3029], 19);
});

test('pose and view commands grow at a full frame boundary without dropping their tails', () => {
  for (const kind of ['pose', 'view', 'bytes'] as const) {
    const writer = new CommandWriter();
    writer.put(new Uint32Array(1022).fill(123), []);
    if (kind === 'pose') writer.teleport(4, [1, 2, 3], [0, 0, 0, 1]);
    if (kind === 'view') writer.view([1, 2, 3], [4, 5, 6], 0.5, 300);
    if (kind === 'bytes') writer.put([7], [], new Uint8Array(17).fill(29));
    const words = writer.take(),
      floats = new Float32Array(words.buffer);
    assert.ok(words.slice(0, 1022).every((value) => value === 123));
    if (kind === 'pose') assert.deepEqual([...floats.slice(1024, 1031)], [1, 2, 3, 0, 0, 0, 1]);
    if (kind === 'view')
      assert.deepEqual([...floats.slice(1023, 1031)], [1, 2, 3, 4, 5, 6, 0.5, 300]);
    if (kind === 'bytes')
      assert.deepEqual(
        [...new Uint8Array(words.buffer, 4092, 20)],
        [...new Array(17).fill(29), 0, 0, 0],
      );
  }
});

test('recycled exact-size buffers are reused and other returned buffers remain usable', () => {
  for (const reverse of [false, true]) {
    const writer = new CommandWriter();
    writer.put(new Uint32Array(1024).fill(7), []);
    const first = writer.take();
    writer.put(new Uint32Array(2048).fill(8), []);
    const second = writer.take();
    writer.recycle(reverse ? [second.buffer, first.buffer] : [first.buffer, second.buffer]);
    writer.put(new Uint32Array(2048).fill(9), []);
    const third = writer.take();
    assert.equal(third.buffer, second.buffer);
    writer.put(new Uint32Array(1024).fill(10), []);
    const fourth = writer.take();
    assert.equal(fourth.buffer, first.buffer);
    assert.ok(fourth.every((value) => value === 10));
  }
});
