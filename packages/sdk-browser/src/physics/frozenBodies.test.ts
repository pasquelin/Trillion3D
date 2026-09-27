import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_INDEX,
  CommandWriter,
  LAYER,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { random } from '../page/cut/cutRuleChecks.fixture.ts';
import { body, startModule, type Module } from './module.fixture.ts';

/** Half size of the test boxes, and the radius of their bounds (`report.cpp` place). */
const HALF = 0.5;
const RADIUS = HALF * Math.sqrt(3);

/** A weightless world of boxes at `centres`, each moving at 1 m/s along x, on the decorative layer
 *  when `decorative`: added in a first step of no time, after the commands `view` writes. */
async function boxes(centres: number[][], view: (w: CommandWriter) => void, decorative = false) {
  const jolt = await startModule({ bodies: Math.max(64, centres.length) });
  const writer = new CommandWriter();
  writer.gravity([0, 0, 0]);
  view(writer);
  centres.forEach((centre, id) => {
    const record = { ...body(id, 2, 0, HALF), position: centre };
    writer.add(decorative ? { ...record, layer: LAYER.decorative } : record);
    writer.velocity(id, [1, 0, 0]);
  });
  const first = poses(jolt, jolt.step(writer.take(), 0));
  return { jolt, writer, first };
}

/** The last step's poses by engine id: position, then linear velocity. */
function poses(jolt: Module, count: number) {
  const words = jolt.poses(count),
    floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  const found = new Map<number, number[]>();
  for (let r = 0; r < count; r++) {
    const at = r * POSE_WORDS;
    found.set(words[at] & BODY_INDEX, [
      ...floats.subarray(at + 1, at + 4),
      ...floats.subarray(at + 8, at + 11),
    ]);
  }
  return found;
}

/** One step of `dt` after the commands `write` adds: its poses and the bodies placed meanwhile. */
function step(jolt: Module, writer: CommandWriter, write: () => void, dt = 1 / 60) {
  write();
  const placed = jolt.visits.place();
  const found = poses(jolt, jolt.step(writer.take(), dt));
  return { found, placed: jolt.visits.place() - placed };
}

test('a body frozen beyond the range is not measured again before the eye could reach it, then resumes with its velocities', async () => {
  const centres = Array.from({ length: 8 }, (_, i) => [100.5 + 3 * i, 0, 0]);
  const look = (w: CommandWriter, x: number) => w.view([x, 0, 0], [1, 0, 0], 0, 50);
  const { jolt, writer, first } = await boxes(centres, (w) => look(w, 0));
  assert.equal(first.size, 0, 'every body is frozen beyond the range at once');
  const thawed = new Map<number, number>();
  for (let x = 1; x <= 90; x++) {
    const { found, placed } = step(jolt, writer, () => look(writer, x));
    // The nearest body cannot be in range before the eye travelled its margin (49.6 m).
    if (x <= 49) assert.equal(placed, 0, `no body measured at x = ${x}`);
    for (const [id, pose] of found) {
      if (thawed.has(id)) continue;
      thawed.set(id, x);
      assert.deepEqual(pose, [centres[id][0], 0, 0, 1, 0, 0], 'resumes where and as it froze');
    }
  }
  // Thawed at the first step where the eye is within the range of its bounds: 100.5 + 3i - x - r <= 50.
  for (let id = 0; id < centres.length; id++)
    assert.equal(thawed.get(id), Math.ceil(centres[id][0] - RADIUS - 50), `body ${id}`);
});

test('frozen bodies thaw on the step the eye comes in range, on a random walk, range changes and non-finite eyes', async () => {
  const next = random(976);
  const centres = Array.from({ length: 400 }, () => [
    (next() - 0.5) * 300,
    (next() - 0.5) * 20,
    (next() - 0.5) * 300,
  ]);
  let eye = [0, 0, 0],
    heading = [0.5, 0, 0],
    range = 20;
  const look = (w: CommandWriter) => w.view(eye, [0, 0, -1], 0, range);
  const { jolt, writer, first } = await boxes(centres, look);
  const frozen = new Set(centres.keys());
  const settle = (found: Map<number, number[]>, label: string) => {
    for (const id of frozen) {
      const [x, y, z] = centres[id];
      const gap = Math.hypot(x - eye[0], y - eye[1], z - eye[2]) - RADIUS - range;
      // Within float rounding of the range's edge, either answer holds.
      if (Math.abs(gap) < 1e-3) {
        if (found.has(id)) frozen.delete(id);
        continue;
      }
      // A non-finite gap places the body nowhere, so seen (`report.cpp` place).
      const inRange = !(gap > 0 && gap < Infinity) || range === 0;
      assert.equal(found.has(id), inRange, `${label}: body ${id}, gap ${gap}`);
      if (inRange) frozen.delete(id);
    }
  };
  settle(first, 'start');
  for (let s = 0; s < 400; s++) {
    // A heading across the world, sometimes a new one, a jump or a new range.
    if (next() < 0.05) heading = [next() - 0.5, (next() - 0.5) * 0.1, next() - 0.5];
    const jump = next() < 0.02 ? 100 : 1;
    // Turned back at the world's edge.
    heading = heading.map((h, k) => (Math.abs(eye[k]) > 150 && h * eye[k] > 0 ? -h : h));
    eye = eye.map((v, k) => v + heading[k] * 3 * jump);
    if (next() < 0.03) range = 5 + Math.round(next() * 55);
    settle(step(jolt, writer, () => look(writer)).found, `step ${s}`);
  }
  // Non-finite eyes place every body nowhere, so thaw them all; back at the origin, the far ones freeze again.
  for (const [label, at] of [
    ['an infinite eye', [Infinity, 0, 0]],
    ['a NaN eye', [NaN, 0, 0]],
  ] as const) {
    assert.ok(frozen.size > 0, `${label}: some bodies still frozen`);
    eye = [...at];
    settle(step(jolt, writer, () => look(writer)).found, label);
    assert.equal(frozen.size, 0, `${label} thaws every body`);
    eye = [0, 0, 0];
    step(jolt, writer, () => look(writer));
    for (const [id, [x, y, z]] of centres.entries())
      if (Math.hypot(x, y, z) - RADIUS - range > 1e-3) frozen.add(id);
  }
});

test('a decorative body out of view is frozen and measured every step, then thaws and sends its pose once seen', async () => {
  const look = (w: CommandWriter, facing: number[]) => w.view([0, 0, 0], facing, 0.5, 0);
  const { jolt, writer, first } = await boxes([[0, 0, 20]], (w) => look(w, [0, 0, -1]), true);
  assert.equal(first.size, 0, 'behind the eye: frozen, no pose');
  for (let s = 0; s < 5; s++) {
    const { found, placed } = step(jolt, writer, () => {});
    assert.equal(found.size, 0);
    assert.equal(placed, 1, 'unseen but in range: measured again every step');
  }
  const { found } = step(jolt, writer, () => look(writer, [0, 0, 1]));
  assert.deepEqual(
    found.get(0),
    [0, 0, 20, 1, 0, 0],
    'seen: thawed where it froze, its velocity kept',
  );
});
