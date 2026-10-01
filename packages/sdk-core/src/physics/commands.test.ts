import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter } from './commands.ts';
import { ADD_WORDS, DAMPING, JOINT_WORDS, OP, PART_WORDS, SHAPE, VIEW_WORDS } from './layout.ts';
import type { BodyRecord } from './bodyRecord.ts';
import { RESTORE_WORDS } from './wire.fixture.ts';

/** The words and the same words read as floats. */
const read = (words: Uint32Array) => ({ words, floats: new Float32Array(words.buffer) });
/** Each ADD field's word, as `commands.cpp` reads it (`w + n`). */
const ADD_AT = { position: 6, quaternion: 9, size: 13, matter: 16, damping: 21, counts: 23 };

const body: BodyRecord = {
  ...{ id: 19, motion: 1, layer: 2, shape: SHAPE.box, flags: 7 },
  ...{ position: [1, 2, 3], quaternion: [0, 0, 0, 1], size: [2, 3, 4] },
  ...{ mass: 5, density: 6, friction: 0.25, restitution: 0.5, gravityScale: 1 },
};

test('ADD carries its fixed words at their layout offsets, then the mesh', () => {
  const writer = new CommandWriter();
  writer.add({
    ...{ id: 7, motion: 2, layer: 1, shape: SHAPE.triangles, flags: 4 },
    ...{ position: [1, 2, 3], quaternion: [0, 0, 0, 1], size: [0.5, 0.25, 0.125] },
    ...{ mass: 80, density: 600, friction: 0.25, restitution: 0.75, gravityScale: 0.5 },
    ...{ damping: [0, 0.125], vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
  });
  const { words, floats } = read(writer.take());
  assert.equal(words.length, ADD_WORDS + 9 + 3);
  assert.deepEqual([...words.subarray(0, ADD_AT.position)], [OP.add, 7, 2, 1, SHAPE.triangles, 4]);
  assert.deepEqual([...floats.subarray(ADD_AT.position, ADD_AT.quaternion)], [1, 2, 3]);
  assert.deepEqual(
    [...floats.subarray(ADD_AT.size, ADD_AT.counts)],
    [0.5, 0.25, 0.125, 80, 600, 0.25, 0.75, 0.5, 0, 0.125],
  );
  assert.deepEqual([...words.subarray(ADD_AT.counts, ADD_WORDS)], [3, 3]);
  assert.deepEqual([...floats.subarray(ADD_WORDS, ADD_WORDS + 9)], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual([...words.subarray(ADD_WORDS + 9)], [0, 1, 2]);
  assert.equal(writer.length, 0);
});

test('ADD of a body that sets no damping carries the simulation’s own', () => {
  const writer = new CommandWriter();
  writer.add(body);
  const { floats } = read(writer.take());
  assert.deepEqual(
    [...floats.subarray(ADD_AT.damping, ADD_AT.counts)],
    [DAMPING, DAMPING].map(Math.fround),
  );
});

test('ADD of a compound carries its parts, then its mass frame, then the next command', () => {
  const writer = new CommandWriter();
  const parts = [
    { shape: SHAPE.box, size: [2, 3, 4], position: [5, 6, 7], quaternion: [0, 0, 0, 1] },
    { shape: SHAPE.sphere, size: [8, 0, 0], position: [9, 10, 11], quaternion: [0, 1, 0, 0] },
  ] as const;
  writer.add({ ...body, shape: SHAPE.compound, massFrame: [31, 32, 33], parts });
  writer.wake(19);
  const { words, floats } = read(writer.take());
  const data = parts.length * PART_WORDS;
  assert.deepEqual([...words.subarray(ADD_AT.counts, ADD_WORDS)], [0, data + 3]);
  parts.forEach((part, i) => {
    const at = ADD_WORDS + i * PART_WORDS;
    assert.equal(words[at], part.shape);
    assert.deepEqual(
      [...floats.subarray(at + 1, at + PART_WORDS)],
      [...part.size, ...part.position, ...part.quaternion],
    );
  });
  assert.deepEqual([...floats.subarray(ADD_WORDS + data, ADD_WORDS + data + 3)], [31, 32, 33]);
  assert.deepEqual([...words.subarray(ADD_WORDS + data + 3)], [OP.wake, 19]);
});

test('ADD of a large mesh carries every vertex and index, then its mass frame', () => {
  const writer = new CommandWriter();
  const vertices = Float32Array.from({ length: 1200 }, (_, i) => i + 0.5);
  const indices = Uint32Array.from({ length: 1800 }, (_, i) => i % 400);
  writer.add({ ...body, shape: SHAPE.triangles, vertices, indices, massFrame: [21, 22, 23] });
  writer.wake(19);
  const { words, floats } = read(writer.take());
  const end = ADD_WORDS + vertices.length + indices.length;
  assert.deepEqual([...words.subarray(ADD_AT.counts, ADD_WORDS)], [400, indices.length + 3]);
  assert.deepEqual(floats.slice(ADD_WORDS, ADD_WORDS + vertices.length), vertices);
  assert.deepEqual(words.slice(ADD_WORDS + vertices.length, end), indices);
  assert.deepEqual([...floats.subarray(end, end + 3)], [21, 22, 23]);
  assert.deepEqual([...words.subarray(end + 3)], [OP.wake, 19]);
});

test('each body command carries its opcode, its body and its numbers, and nothing more', () => {
  const writer = new CommandWriter();
  const cases: [() => void, number[], number[]][] = [
    [() => writer.remove(7), [OP.remove, 7], []],
    [() => writer.wake(8), [OP.wake, 8], []],
    [() => writer.release(9), [OP.release, 9], []],
    [() => writer.unjoint(10), [OP.unjoint, 10], []],
    [() => writer.velocity(11, [1, 2, 3]), [OP.velocity, 11], [1, 2, 3]],
    [() => writer.impulse(12, [-1, 4, 5]), [OP.impulse, 12], [-1, 4, 5]],
    [() => writer.gravity([3, -10, 2]), [OP.gravity], [3, -10, 2]],
    [() => writer.gravityScale(13, 0.5), [OP.gravityScale, 13], [0.5]],
    [() => writer.flags(14, 17), [OP.flags, 14, 17], []],
    [() => writer.material(15, 0.25, 0.5), [OP.material, 15], [0.25, 0.5]],
    [
      () => writer.teleport(16, [1, 2, 3], [0, 0.5, 0, 0.5]),
      [OP.teleport, 16],
      [1, 2, 3, 0, 0.5, 0, 0.5],
    ],
    [
      () => writer.moveKinematic(17, [4, 5, 6], [0.5, 0, 0.5, 0]),
      [OP.moveKinematic, 17],
      [4, 5, 6, 0.5, 0, 0.5, 0],
    ],
  ];
  for (const [write, integers, numbers] of cases) {
    write();
    const { words, floats } = read(writer.take());
    assert.equal(words.length, integers.length + numbers.length, `${integers[0]}`);
    assert.deepEqual([...words.subarray(0, integers.length)], integers);
    assert.deepEqual([...floats.subarray(integers.length, words.length)], numbers);
    assert.equal(writer.length, 0);
  }
});

test('RESTORE carries its handle and byte count, then the bytes padded with zeros to whole words', () => {
  const writer = new CommandWriter();
  for (const bytes of [[], [1], [2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12, 13]]) {
    // The writer's buffer still holds the last frame's words: the padding is written, not assumed.
    writer.put(new Uint32Array(8).fill(0xffffffff), []);
    writer.take();
    writer.restore(17, Uint8Array.from(bytes));
    const { words } = read(writer.take());
    assert.deepEqual([...words.subarray(0, RESTORE_WORDS)], [OP.restore, 17, bytes.length]);
    const padded = Math.ceil(bytes.length / 4) * 4;
    assert.equal(words.length, RESTORE_WORDS + padded / 4);
    const payload = [...new Uint8Array(words.buffer, RESTORE_WORDS * 4, padded)];
    assert.deepEqual(payload, [...bytes, ...new Array(padded - bytes.length).fill(0)]);
  }
});

test('VIEW carries the eye, the facing, the cone and the range', () => {
  const writer = new CommandWriter();
  writer.view([1, 2, 3], [0, 0, -1], 0.5, 400);
  const { words, floats } = read(writer.take());
  assert.equal(words.length, VIEW_WORDS);
  assert.equal(words[0], OP.view);
  assert.deepEqual([...floats.subarray(1, VIEW_WORDS)], [1, 2, 3, 0, 0, -1, 0.5, 400]);
});

test('JOINT carries its ids and frames, its motor, then its own words; MOTOR its new motor', () => {
  const writer = new CommandWriter();
  const frameA = [1, 2, 3, 4, 5, 6, 7, 8, 9],
    frameB = [11, 12, 13, 14, 15, 16, 17, 18, 19];
  const limits = [-2, 3, 4, 0.5],
    extra = [21, 22, 23];
  writer.wake(19);
  writer.joint({
    ...{ id: 23, kind: 8, a: 31, b: -1, frameA, frameB, limits },
    ...{ motor: { mode: 2, axis: 5, target: 6, maxForce: 7 }, breakForce: 8, extra },
  });
  writer.motor(23, { mode: 1, axis: 4, target: -3, maxForce: 9 });
  const { words, floats } = read(writer.take());
  const joint = words.subarray(2),
    jointFloats = floats.subarray(2);
  // `op, id, kind, a, b (-1: the world's MISS), motor mode, motor axis, extra count`.
  assert.deepEqual(
    [...joint.subarray(0, 8)],
    [OP.joint, 23, 8, 31, 0xffffffff, 2, 5, extra.length],
  );
  assert.deepEqual(
    [...jointFloats.subarray(8, JOINT_WORDS + extra.length)],
    [...frameA, ...frameB, ...limits, 6, 7, 8, ...extra],
  );
  const motor = read(joint.slice(JOINT_WORDS + extra.length));
  assert.deepEqual([...motor.words.subarray(0, 4)], [OP.motor, 23, 1, 4]);
  assert.deepEqual([...motor.floats.subarray(4)], [-3, 9]);
});

test('put carries whole words (negatives as their unsigned word), then floats, then bytes', () => {
  const writer = new CommandWriter();
  writer.put([-1, 3], [0.5, -2], new Uint8Array([23]));
  const { words, floats } = read(writer.take());
  assert.deepEqual([...words.subarray(0, 2)], [0xffffffff, 3]);
  assert.deepEqual([...floats.subarray(2, 4)], [0.5, -2]);
  assert.deepEqual([...new Uint8Array(words.buffer, 16, 4)], [23, 0, 0, 0]);
  assert.equal(words.length, 5);
});

test('a frame grows past the first buffer whole, a command across the boundary included', () => {
  const fill = 1022;
  for (const write of [
    (w: CommandWriter) => w.teleport(4, [1, 2, 3], [0, 0, 0, 1]),
    (w: CommandWriter) => w.view([1, 2, 3], [4, 5, 6], 0.5, 300),
    (w: CommandWriter) => w.put([7], [], new Uint8Array(17).fill(29)),
    (w: CommandWriter) => w.add(body),
  ]) {
    const writer = new CommandWriter(),
      alone = new CommandWriter();
    writer.put(new Uint32Array(fill).fill(123), []);
    write(writer);
    write(alone);
    const { words } = read(writer.take());
    assert.ok(words.subarray(0, fill).every((value) => value === 123));
    assert.deepEqual([...words.subarray(fill)], [...alone.take()]);
  }
  const writer = new CommandWriter();
  for (let i = 0; i < 1100; i++) writer.impulse(i, [i, -i, 0.5]);
  const { words, floats } = read(writer.take());
  assert.equal(words.length, 1100 * 5);
  for (let i = 0; i < 1100; i++) {
    assert.deepEqual([...words.subarray(i * 5, i * 5 + 2)], [OP.impulse, i]);
    assert.deepEqual([...floats.subarray(i * 5 + 2, i * 5 + 5)], [i, -i, 0.5]);
  }
});

test('a taken frame is its own: later frames, through recycled buffers, never write over it', () => {
  for (const reverse of [false, true]) {
    const writer = new CommandWriter();
    writer.put(new Uint32Array(1024).fill(7), []);
    const first = writer.take();
    writer.put(new Uint32Array(2048).fill(8), []);
    const second = writer.take();
    const kept = second.slice();
    writer.recycle(reverse ? [second.buffer, first.buffer] : [first.buffer, second.buffer]);
    writer.put(new Uint32Array(2048).fill(9), []);
    assert.equal(writer.take().buffer, second.buffer, 'the one that holds it');
    writer.put(new Uint32Array(1024).fill(10), []);
    const fourth = writer.take();
    assert.equal(fourth.buffer, first.buffer);
    assert.ok(fourth.every((value) => value === 10));
    assert.notDeepEqual(second, kept, 'handed back, it was reused');
    writer.put([1], []);
    const fifth = writer.take();
    assert.notEqual(fifth.buffer, first.buffer);
    assert.ok(
      fourth.every((value) => value === 10),
      'a frame not handed back is never reused',
    );
  }
});
