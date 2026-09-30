import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';

test('each simulation request retains its arguments in the native command stream', () => {
  const writer = new CommandWriter();
  const cases: [string, () => void, number[], number[]][] = [
    ['remove', () => writer.remove(7), [OP.remove, 7], []],
    ['wake', () => writer.wake(8), [OP.wake, 8], []],
    ['release', () => writer.release(9), [OP.release, 9], []],
    ['unjoint', () => writer.unjoint(10), [OP.unjoint, 10], []],
    ['velocity', () => writer.velocity(11, [1, 2, 3]), [OP.velocity, 11], [1, 2, 3]],
    ['impulse', () => writer.impulse(12, [-1, 4, 5]), [OP.impulse, 12], [-1, 4, 5]],
    ['gravity', () => writer.gravity([3, -10, 2]), [OP.gravity], [3, -10, 2]],
    ['gravityScale', () => writer.gravityScale(13, 0.5), [OP.gravityScale, 13], [0.5]],
    ['flags', () => writer.flags(14, 17), [OP.flags, 14, 17], []],
    ['material', () => writer.material(15, 0.25, 0.5), [OP.material, 15], [0.25, 0.5]],
    [
      'teleport',
      () => writer.teleport(16, [1, 2, 3], [0, 0.5, 0, 0.5]),
      [OP.teleport, 16],
      [1, 2, 3, 0, 0.5, 0, 0.5],
    ],
    [
      'moveKinematic',
      () => writer.moveKinematic(17, [4, 5, 6], [0.5, 0, 0.5, 0]),
      [OP.moveKinematic, 17],
      [4, 5, 6, 0.5, 0, 0.5, 0],
    ],
  ];
  for (const [name, write, integers, floats] of cases) {
    write();
    const result = writer.take();
    assert.equal(result.length, integers.length + floats.length, name);
    assert.deepEqual([...result.slice(0, integers.length)], integers, name);
    assert.deepEqual(
      [...new Float32Array(result.buffer).slice(integers.length, result.length)],
      floats,
      name,
    );
    assert.equal(writer.length, 0);
  }
});

test('growth, byte padding and recycling preserve complete independent frame buffers', () => {
  const writer = new CommandWriter();
  for (let i = 0; i < 1100; i++) writer.impulse(i, [i, -i, 0.5]);
  const first = writer.take();
  assert.equal(first.length, 5500);
  const floats = new Float32Array(first.buffer);
  for (let i = 0; i < 1100; i++) {
    assert.deepEqual([...first.slice(i * 5, i * 5 + 2)], [OP.impulse, i]);
    assert.deepEqual([...floats.slice(i * 5 + 2, i * 5 + 5)], [i, -i, 0.5]);
  }
  const retained = first.slice();
  for (const bytes of [[], [1], [2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12, 13]]) {
    writer.restore(17, new Uint8Array(bytes));
    const result = writer.take();
    assert.deepEqual([...result.slice(0, 3)], [OP.restore, 17, bytes.length]);
    const payload = new Uint8Array(result.buffer, 12, result.byteLength - 12);
    assert.deepEqual([...payload.slice(0, bytes.length)], bytes);
    assert.ok(payload.slice(bytes.length).every((value) => value === 0));
    writer.recycle([result.buffer]);
  }
  assert.deepEqual(first, retained);
  writer.put([-1, 3], [0.5, -2], new Uint8Array([23]));
  const mixed = writer.take();
  assert.deepEqual([...mixed.slice(0, 2)], [0xffffffff, 3]);
  assert.deepEqual([...new Float32Array(mixed.buffer).slice(2, 4)], [0.5, -2]);
  assert.deepEqual([...new Uint8Array(mixed.buffer, 0, mixed.byteLength).slice(16)], [23, 0, 0, 0]);
});

test('joint frames, motors and extra track data survive adjacent commands', () => {
  const writer = new CommandWriter();
  writer.wake(19);
  writer.joint({
    id: 23,
    kind: 8,
    a: 31,
    b: -1,
    frameA: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    frameB: [11, 12, 13, 14, 15, 16, 17, 18, 19],
    limits: [-2, 3, 4, 0.5],
    motor: { mode: 2, axis: 5, target: 6, maxForce: 7 },
    breakForce: 8,
    extra: [21, 22, 23],
  });
  writer.motor(23, { mode: 1, axis: 4, target: -3, maxForce: 9 });
  const words = writer.take(),
    floats = new Float32Array(words.buffer);
  assert.deepEqual(
    [...words.slice(0, 10)],
    [OP.wake, 19, OP.joint, 23, 8, 31, 0xffffffff, 2, 5, 3],
  );
  assert.deepEqual(
    [...floats.slice(10, 38)],
    [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, -2, 3, 4, 0.5, 6, 7, 8, 21, 22,
      23,
    ],
  );
  assert.deepEqual([...words.slice(38, 42)], [OP.motor, 23, 1, 4]);
  assert.deepEqual([...floats.slice(42, words.length)], [-3, 9]);
});
