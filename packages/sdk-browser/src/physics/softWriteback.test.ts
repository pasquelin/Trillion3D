import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  SOFT_STATE_WORDS,
  SOFT_VERTEX_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { startModule } from './module.fixture.ts';
import { lcg } from '../gpu/hiz/buildTranscripts.fixture.ts';
import { id } from './records.fixture.ts';
import { softBodiesIn, WRITEBACK_BOUND as BOUND, writeSoftBody } from './soft.fixture.ts';
import { writebackScene } from './softWriteback.fixture.ts';

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
  for (const { engine, count, from } of softBodiesIn(expected)) {
    assert.equal(actual[from - SOFT_STATE_WORDS], engine, `${label}: body at ${from}`);
    assert.equal(actual[from - SOFT_STATE_WORDS + 1], count, `${label}: vertex count at ${from}`);
    for (let at = from; at < from + count * 3; at++)
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

type Triple = [number, number, number];

/** Cloths of `segments` × `segments` squares made at rest (no gravity), each at its place, turn
 *  and scale, in slots from 1 of one module, stepped once: each one's worst distance, in metres,
 *  from its own vertices, and its vertex count. With no cloth, the step sends no word. */
async function restingCloths(segments: number, poses: [Triple, number[], Triple][]) {
  const jolt = await startModule({ bodies: poses.length + 1 });
  const writer = new CommandWriter();
  writer.gravity([0, 0, 0]);
  jolt.step(writer.take(), 1 / 60);
  assert.equal(jolt.soft().length, 0, 'no soft body, no word');
  const made = poses.map(([position, quaternion, scale], i) => {
    const geometry = plane(1, 1, segments, segments);
    const record = writeSoftBody(
      writer,
      id(i + 1),
      geometry,
      { type: 'cloth' },
      position,
      quaternion,
      {
        scale,
      },
    );
    return 'vertices' in record ? record.vertices : new Float32Array();
  });
  jolt.step(writer.take(), 0);
  jolt.step(null, 1 / 60);
  const words = jolt.soft();
  const written = new Float32Array(words.buffer, words.byteOffset, words.length);
  return [...softBodiesIn(words)].map(({ engine, count, from }, i) => {
    assert.equal(engine, id(i + 1));
    let worst = 0;
    for (let v = 0; v < count * 3; v++) {
      const c = v % 3,
        own = made[i][((v - c) / 3) * SOFT_VERTEX_WORDS + c];
      worst = Math.max(worst, Math.abs(written[from + v] - own));
    }
    return { count, worst };
  });
}

test('a resting soft body writes back its own vertices, at random places, turns and scales', async () => {
  const random = lcg(975);
  const draw = (reach: number) => (random() * 2 - 1) * reach;
  const poses = Array.from({ length: 24 }, (_, n): [Triple, number[], Triple] => {
    const q = [draw(1), draw(1), draw(1), draw(1)];
    const length = Math.hypot(...q);
    // Both zeros in turn: -0 and +0 on every axis, where the chain and the matrix may differ.
    const zero = n % 2 ? -0 : 0;
    const position: Triple = n < 2 ? [zero, zero, zero] : [draw(30), draw(30), draw(30)];
    const scale: Triple = [0.5 + random() * 1.5, 0.5 + random() * 1.5, 0.5 + random() * 1.5];
    return [position, q.map((c) => c / length), scale];
  });
  const cloths = await restingCloths(4, poses);
  assert.equal(cloths.length, poses.length);
  cloths.forEach(({ worst }, n) => assert.ok(worst <= BOUND, `${n}: ${worst} m off`));
});

test('a soft body of the whole default budget writes back every vertex', async () => {
  // 128 × 128 vertices: the default `softVertices`, one body.
  const [{ count, worst }] = await restingCloths(127, [
    [
      [3, -0, -7],
      [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      [1, 1, 1],
    ],
  ]);
  assert.equal(count, DEFAULT_PHYSICS_BUDGET.softVertices);
  assert.ok(worst <= BOUND, `${worst} m off`);
});
