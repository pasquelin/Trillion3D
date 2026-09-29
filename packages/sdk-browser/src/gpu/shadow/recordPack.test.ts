// The records the shading reads: a lamp's faces and header, a sun's frame, depth range, windows
// and levels, each pushed only when one of its numbers changed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  SHADOW_RECORD_FRAME,
  SHADOW_RECORD_INFO,
  SHADOW_RECORD_ORIGINS,
} from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { createSunLevels } from '../../../../sdk-core/src/scene/light-shadow/sunLevels.ts';
import { createShadowRecordPack } from './recordPack.ts';
import { VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';

/** Records the pack flags to push, drained. */
function flushed(pack: ReturnType<typeof createShadowRecordPack>) {
  const slices: number[] = [];
  pack.flush((slice) => slices.push(slice));
  return slices;
}

test("a lamp's record is its face matrices and header, and the same numbers push nothing", () => {
  const pack = createShadowRecordPack(256, 32);
  const faces = new Float32Array(6 * 16).map((_, i) => i);
  pack.writeLamp(3, faces, 6, 1, 0.05, 4096);
  const at = 3 * SHADOW_RECORD_FLOATS;
  assert.deepEqual(Array.from(pack.records.subarray(at, at + 96)), Array.from(faces));
  assert.deepEqual(
    Array.from(pack.records.subarray(at + SHADOW_RECORD_INFO, at + SHADOW_RECORD_INFO + 4)),
    [6, 1, Math.fround(0.05), 4096],
  );
  assert.deepEqual(flushed(pack), [3]);
  pack.writeLamp(3, faces, 6, 1, 0.05, 4096);
  assert.deepEqual(flushed(pack), [], 'a still lamp pushes nothing');
  pack.clear(3);
  assert.deepEqual(flushed(pack), [3], 'a freed slice reads no shadow');
  assert.equal(pack.records[at + SHADOW_RECORD_INFO], 0);
});

test("a sun's record is its depth ranges, frame, window origins as integers, and levels", () => {
  const pack = createShadowRecordPack(256, 32),
    sun = createSunLevels();
  sun.update(0, [0, -1, 0], VIEW, [-8, 0, -8], [8, 4, 8], 1);
  sun.update(0, [0, -1, 0], VIEW, [-8, 0, -8], [8, 40, 8], 2);
  pack.writeSun(0, sun, 16, 0);
  const words = new Int32Array(pack.records.buffer);
  // Each range a pair where a lamp's matrices lie, `zNear, zFar`: the first frame's, `[−4, 0]`,
  // then the second's, `[−64, 0]`, current: the frame's fourth floats, then its slot.
  assert.deepEqual(Array.from(pack.records.subarray(0, 4)), [-4, 0, -64, 0]);
  const tail = [0, 1, 2].map((row) => pack.records[SHADOW_RECORD_FRAME + row * 4 + 3]);
  assert.deepEqual(tail, [-64, 0, 1]);
  for (let row = 0; row < 3; row++)
    assert.deepEqual(
      Array.from(
        pack.records.subarray(SHADOW_RECORD_FRAME + row * 4, SHADOW_RECORD_FRAME + row * 4 + 3),
      ),
      Array.from(sun.frame.subarray(row * 3, row * 3 + 3), Math.fround),
    );
  assert.deepEqual(
    Array.from(words.subarray(SHADOW_RECORD_ORIGINS, SHADOW_RECORD_ORIGINS + 32)),
    Array.from(sun.origins.subarray(0, 32)),
  );
  assert.equal(pack.records[SHADOW_RECORD_INFO + 1], sun.finest[0]);
  assert.deepEqual(flushed(pack), [0]);
});
