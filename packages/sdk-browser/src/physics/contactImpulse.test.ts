import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_INDEX,
  CommandWriter,
  EVENT,
  FLAG,
  POSE_WORDS,
  SHAPE,
} from '../../../sdk-core/src/physics/index.ts';
import { events, startModule } from './module.fixture.ts';
import { body, id } from './records.fixture.ts';

const MASS = 10,
  SPEED = 3;

/**
 * A body of `MASS` kg falling at `SPEED` m/s without gravity, friction or damping onto a static
 * floor whose top is y = 0, its lowest point 0.5 mm into it: the impulse its enter reports, and
 * the one the step's solver gave it (its momentum lost upward).
 */
async function landing(
  shape: (typeof SHAPE)[keyof typeof SHAPE],
  size: readonly [number, number, number],
  quaternion: number[],
  low: number,
  restitution: number,
) {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.gravity([0, 0, 0]);
  writer.add({ ...body(id(0), 0, -0.5, 0.5), size: [20, 0.5, 20], restitution });
  const falling = {
    ...body(id(1), 2, low - 0.0005, 0.5, FLAG.events),
    ...{ shape, size, quaternion, mass: MASS, friction: 0, restitution, damping: [0, 0] as const },
  };
  writer.add(falling);
  jolt.step(writer.take(), 0);
  writer.velocity(1, [0, -SPEED, 0]);
  const count = jolt.step(writer.take(), 1 / 60);
  const words = jolt.poses(count),
    floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  const at = Array.from({ length: count }, (_, r) => r * POSE_WORDS).find(
    (r) => (words[r] & BODY_INDEX) === 1,
  );
  assert.ok(at !== undefined, 'the body is posed');
  const enter = events(jolt).find(([type]) => type === EVENT.begin);
  assert.ok(enter, 'the landing is heard');
  return { reported: enter[3], solver: MASS * (floats[at + 9] + SPEED) };
}

const near = (actual: number, expected: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) <= 1e-3 * expected,
    `${what}: ${actual} N·s, not ${expected}`,
  );

test('a box landing flat reports its mass times its speed, and half again when it bounces at 0.5', async () => {
  for (const restitution of [0, 0.5]) {
    const { reported, solver } = await landing(
      SHAPE.box,
      [0.5, 0.5, 0.5],
      [0, 0, 0, 1],
      0.5,
      restitution,
    );
    near(reported, (1 + restitution) * MASS * SPEED, `bounce ${restitution}`);
    near(reported, solver, `bounce ${restitution}, the solver's`);
  }
});

test('a rod landing on its tip reports what stops the tip, its turn included: the solver’s, not its mass times its speed', async () => {
  // A capsule of half height 1 and radius 0.05, turned 45° about z: its lower tip touches first.
  const half = Math.SQRT1_2;
  const turned = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
  for (const restitution of [0, 0.5]) {
    const { reported, solver } = await landing(
      SHAPE.capsule,
      [1, 0.05, 0],
      turned,
      half + 0.05,
      restitution,
    );
    near(reported, solver, `bounce ${restitution}`);
    assert.ok(
      reported < 0.5 * (1 + restitution) * MASS * SPEED,
      `the tip turns away: ${reported} N·s`,
    );
  }
});
