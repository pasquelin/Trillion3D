import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  SOFT_VERTEX_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { startModule } from './module.fixture.ts';
import { CLOTH, writeSoftBody } from './soft.fixture.ts';
import { WRITEBACK_BOUND as BOUND, seeded, writebackScene } from './softWriteback.fixture.ts';

/** Each step's words in `bytes` (`u32` step count, then per step its word count and words). */
function stepsOf(bytes: Uint8Array) {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const steps: Uint32Array[] = [];
  for (let at = 1, s = 0; s < words[0]; s++, at += 1 + words[at])
    steps.push(words.subarray(at + 1, at + 1 + words[at]));
  return steps;
}

/** Fails unless `actual` names the bodies and counts of `expected`, its vertices within `BOUND`. */
function assertWriteback(actual: Uint32Array, expected: Uint32Array, label: string) {
  assert.equal(actual.length, expected.length, `${label}: words`);
  const a = new Float32Array(actual.buffer, actual.byteOffset, actual.length);
  const e = new Float32Array(expected.buffer, expected.byteOffset, expected.length);
  for (let at = 0; at < expected.length;) {
    assert.equal(actual[at], expected[at], `${label}: body at ${at}`);
    assert.equal(actual[at + 1], expected[at + 1], `${label}: vertex count at ${at}`);
    const end = at + 2 + expected[at + 1] * 3;
    for (at += 2; at < end; at++)
      assert.ok(Math.abs(a[at] - e[at]) <= BOUND, `${label}[${at}]: ${a[at]} against ${e[at]}`);
  }
}

test('soft bodies scaled, turned, removed, hidden, remade and teleported write back as on develop', async () => {
  // develop's module (cc7d59061) ran `writebackScene` and wrote these words (#975).
  const url = new URL(
    '../../../../tests/fixtures/physics/soft-writeback-develop.bin',
    import.meta.url,
  );
  const develop = stepsOf(await readFile(url));
  const steps = writebackScene(await startModule());
  assert.equal(steps.length, develop.length);
  steps.forEach((words, s) => assertWriteback(words, develop[s], `kept step ${s}`));
});

/** A cloth of `segments` × `segments` squares made at rest (no gravity) at `position`, turned by
 *  `quaternion`, scaled by `scale`, stepped once: its vertices written back against its own. */
async function restingCloth(
  segments: number,
  position: number[],
  quaternion: number[],
  scale: number[],
) {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.gravity([0, 0, 0]);
  const record = writeSoftBody(
    writer,
    CLOTH,
    plane(1, 1, segments, segments),
    { type: 'cloth' },
    position,
    quaternion,
    {
      scale: scale as [number, number, number],
    },
  );
  jolt.step(writer.take(), 0);
  jolt.step(null, 1 / 60);
  const words = jolt.soft();
  assert.equal(words[0], CLOTH);
  const written = new Float32Array(words.buffer, words.byteOffset + 8, words[1] * 3);
  const made = (record as { vertices: Float32Array }).vertices;
  let worst = 0;
  for (let v = 0; v < words[1]; v++)
    for (let c = 0; c < 3; c++)
      worst = Math.max(worst, Math.abs(written[v * 3 + c] - made[v * SOFT_VERTEX_WORDS + c]));
  return { count: words[1], worst };
}

test('a resting soft body writes back its own vertices, at random places, turns and scales', async () => {
  const random = seeded(975);
  const draw = (reach: number) => (random() * 2 - 1) * reach;
  for (let n = 0; n < 24; n++) {
    const q = [draw(1), draw(1), draw(1), draw(1)];
    const length = Math.hypot(...q);
    // Both zeros in turn: -0 and +0 on every axis, where the chain and the matrix may differ.
    const zero = n % 2 ? -0 : 0;
    const position = n < 2 ? [zero, zero, zero] : [draw(30), draw(30), draw(30)];
    const scale = [0.5 + random() * 1.5, 0.5 + random() * 1.5, 0.5 + random() * 1.5];
    const { worst } = await restingCloth(
      4,
      position,
      q.map((c) => c / length),
      scale,
    );
    assert.ok(worst <= BOUND, `${n}: ${worst} m off`);
  }
});

test('a soft body of the whole default budget writes back every vertex, and none sends nothing', async () => {
  // 128 × 128 vertices: the default `softVertices`, one body.
  const { count, worst } = await restingCloth(
    127,
    [3, -0, -7],
    [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    [1, 1, 1],
  );
  assert.equal(count, DEFAULT_PHYSICS_BUDGET.softVertices);
  assert.ok(worst <= BOUND, `${worst} m off`);
  const empty = await startModule();
  empty.step(null, 1 / 60);
  assert.equal(empty.soft().length, 0);
});
