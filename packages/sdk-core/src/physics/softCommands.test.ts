import test from 'node:test';
import assert from 'node:assert/strict';
import { plane } from '../world/geometry/basic.ts';
import { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import { softBodyOf } from './soft.ts';
import { writeSoft } from './softCommands.ts';
import { softSettings } from './softSettings.ts';
import { SOFT_WORDS } from './wire.fixture.ts';

const one = { x: 1, y: 1, z: 1 };

test('SOFT carries its fixed words at their layout offsets, then the vertices and corners', () => {
  const settings = softSettings({ type: 'volume', stretch: 0.25, bend: 0.5, pressure: 0.5 });
  const record = softBodyOf(plane(1, 1, 1, 1), one, settings);
  const writer = new CommandWriter();
  writeSoft(writer, {
    ...{ id: 9, position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [2, 3, 4] },
    ...{ friction: 0.125, restitution: 0.375, gravityScale: 0.5, linearDamping: 0.0625 },
    ...{ settings, record },
  });
  const words = writer.take(),
    floats = new Float32Array(words.buffer);
  assert.deepEqual([...words.subarray(0, 2)], [OP.soft, 9]);
  assert.deepEqual(
    [...floats.subarray(2, 19)],
    [1, 2, 3, 0, 0, 0, 1, 2, 3, 4, 0.125, 0.375, 0.5, 0.0625, 0.25, 0.5, 0.5],
  );
  assert.deepEqual([words[19], words[20], words[21]], [4, 6, 0]);
  assert.deepEqual([...floats.subarray(SOFT_WORDS, SOFT_WORDS + 16)], [...record.vertices]);
  assert.deepEqual([...words.subarray(SOFT_WORDS + 16)], [...record.indices]);
});

test('a cooked SOFT carries no vertex nor corner: its settings bytes, padded to whole words', () => {
  const writer = new CommandWriter();
  writeSoft(writer, {
    ...{ id: 9, position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] },
    ...{ friction: 0.5, restitution: 0, gravityScale: 1, linearDamping: 0.05 },
    ...{ settings: { stretch: 0, bend: Infinity } },
    record: { cooked: Uint8Array.of(1, 2, 3, 4, 5), pressure: 7 },
  });
  const words = writer.take();
  assert.equal(new Float32Array(words.buffer)[18], 7, 'the pressure word');
  assert.deepEqual([words[19], words[20], words[21]], [0, 0, 5]);
  assert.equal(words.length, SOFT_WORDS + 2);
  assert.deepEqual([...new Uint8Array(words.buffer, SOFT_WORDS * 4, 8)], [1, 2, 3, 4, 5, 0, 0, 0]);
});
