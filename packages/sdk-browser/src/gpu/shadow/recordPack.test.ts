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
  const pack = createShadowRecordPack(256);
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

test("a sun's record is its frame, depth range, window origins as integers, and levels", () => {
  const pack = createShadowRecordPack(256),
    sun = createSunLevels();
  sun.update(0, [0, -1, 0], VIEW, [-8, 0, -8], [8, 4, 8], 1);
  pack.writeSun(0, sun, 16, 0);
  const words = new Int32Array(pack.records.buffer);
  assert.deepEqual(
    Array.from(pack.records.subarray(SHADOW_RECORD_FRAME, SHADOW_RECORD_FRAME + 12)),
    [...sun.frame.subarray(0, 3), sun.depth[0], ...sun.frame.subarray(3, 6), sun.depth[1]]
      .concat([...sun.frame.subarray(6, 9), 0])
      .map(Math.fround),
  );
  assert.deepEqual(
    Array.from(words.subarray(SHADOW_RECORD_ORIGINS, SHADOW_RECORD_ORIGINS + 32)),
    Array.from(sun.origins.subarray(0, 32)),
  );
  assert.equal(pack.records[SHADOW_RECORD_INFO + 1], sun.finest[0]);
  assert.deepEqual(flushed(pack), [0]);
});
