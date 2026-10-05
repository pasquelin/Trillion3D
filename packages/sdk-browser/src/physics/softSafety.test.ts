// Damping safety of a soft body: what its damping lets it fall at, whole or hanging (`soft.ts`, `SOFT_DAMPING`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import {
  BODY_INDEX,
  CommandWriter,
  type SoftBodyOptions,
  type SoftBodyRecord,
} from '../../../sdk-core/src/physics/index.ts';
import { SOFT_DAMPING } from '../../../sdk-core/src/physics/soft.ts';
import { fromArrays } from '../../../sdk-core/src/world/geometry/builder.ts';
import { type Module } from './module.fixture.ts';
import { addSoft, CLOTH, softWorld, stepped } from './soft.fixture.ts';
import { FLAT } from './records.fixture.ts';

const G = 9.81;
/** The module's substep (`SoftBodyCreationSettings::mNumIterations`, 5 a step of 1/60 s). */
const SUBSTEP = 1 / 300;

function fallSpeed(jolt: Module, record: { map: Uint32Array }, seconds: number) {
  let [last, speed] = [Number.NaN, 0];
  for (const { vertices, recovered } of stepped(jolt, record, seconds)) {
    assert.deepEqual(recovered, [], 'falling whole, never diverged');
    // Laid flat: the geometry's −z is the world's down.
    if (vertices) [speed, last] = [(last - vertices[2]) * 60, vertices[2]];
  }
  return speed;
}

/** The speed, m/s, a body damped by `c` reaches after `seconds` of falling under `pull`, as the
 *  module damps it each substep: `v ← (v + g·h)(1 − c·h)`. */
function damped(c: number, pull: number, seconds: number) {
  let v = 0;
  for (let k = 0; k < seconds / SUBSTEP; k++) v = (v + pull * SUBSTEP) * (1 - c * SUBSTEP);
  return v;
}

/** A 1 m cloth of 10 × 10 squares laid flat `height` m up: the module stepping it, and its record. */
async function dropped(
  options: Partial<SoftBodyOptions>,
  words: Partial<SoftBodyRecord>,
  height = 60,
) {
  const jolt = await softWorld();
  const record = addSoft(
    jolt,
    plane(1, 1, 10, 10),
    { type: 'cloth', ...options } as SoftBodyOptions,
    [0, height, 0],
    { quaternion: FLAT, ...words },
  );
  return { jolt, record };
}

test('a soft body that declares no damping falls at most at g / 0.603, whatever it weighs; one declaring none falls freely', async () => {
  // Damped each substep, it settles at `g·(1 − c·h)/c`, 16.2 m/s, within a few times `1/c`,
  // 1.66 s; the module's bound on it (its swing, 52.7 m/s) never holds it back. A 1 m² tarp of 5 kg
  // falls alike: the default damping is a share of speed, not air on its area.
  for (const mass of [undefined, 5]) {
    const { jolt, record } = await dropped({ mass }, { linearDamping: SOFT_DAMPING }, 2000);
    const speed = fallSpeed(jolt, record, 15),
      expected = damped(SOFT_DAMPING, G, 15);
    assert.ok(
      Math.abs(speed - expected) < 0.005 * expected,
      `${mass}: ${speed} m/s, not ${expected}`,
    );
  }
  const bare = await dropped({}, { linearDamping: 0 });
  const free = fallSpeed(bare.jolt, bare.record, 1);
  assert.ok(Math.abs(free - G) < 0.02 * G, `free, ${free} m/s after a second`);
});

test('a soft body falling whole is never held back: past its swing, it falls as its damping and the pull it is under now allow', async () => {
  // A 0.14 m cloth: its swing's bound is a fall from 14 m, 16.7 m/s under Earth's pull.
  const drop = async (
    linearDamping: number,
    seconds: number,
    gravity?: readonly number[],
    scale?: number,
  ) => {
    const jolt = await softWorld();
    const record = addSoft(jolt, plane(0.1, 0.1, 2, 2), { type: 'cloth' }, [0, 5000, 0], {
      ...{ quaternion: FLAT, linearDamping },
    });
    // Made under Earth's pull, then put under another, or given its own scale.
    const writer = new CommandWriter();
    if (gravity) writer.gravity(gravity);
    if (scale !== undefined) writer.gravityScale(CLOTH & BODY_INDEX, scale);
    jolt.step(writer.take(), 0);
    return fallSpeed(jolt, record, seconds);
  };
  // Declaring little damping, it falls on past its swing's bound, 39 m/s after 4 s.
  const light = await drop(0.05, 4),
    lightly = damped(0.05, G, 4);
  assert.ok(
    lightly > 17 && Math.abs(light - lightly) < 0.01 * lightly,
    `${light} m/s, not ${lightly}`,
  );
  // Under four times Earth's pull, by the gravity or its own scale: its fall through the default
  // damping, 65 m/s, is what holds it, not the 16.7 m/s of the pull it was made under.
  const expected = damped(SOFT_DAMPING, 4 * G, 15);
  for (const [gravity, scale] of [
    [[0, -4 * G, 0], undefined],
    [undefined, 4],
  ] as const) {
    const speed = await drop(SOFT_DAMPING, 15, gravity, scale);
    assert.ok(Math.abs(speed - expected) < 0.01 * expected, `${speed} m/s, not ${expected}`);
  }
});

test('a rope coiled at rest hangs out to its length: never taken for diverged', async () => {
  for (const length of [2, 5]) {
    // 80 points on a coil of 0.15 m radius, 0.1 m high, pinned at its first, 7 m up.
    const turns = length / (2 * Math.PI * 0.15),
      points: number[] = [];
    for (let i = 0; i < 80; i++) {
      const t = (i / 79) * turns * 2 * Math.PI;
      points.push(0.15 * Math.cos(t), (i / 79) * 0.1, 0.15 * Math.sin(t));
    }
    const jolt = await softWorld();
    const record = addSoft(
      jolt,
      fromArrays(points, [], [], []),
      { type: 'rope', pins: [0] },
      [0, 7, 0],
      { linearDamping: SOFT_DAMPING },
    );
    let lowest = 0;
    for (const { vertices, recovered } of stepped(jolt, record, 10)) {
      assert.deepEqual(recovered, [], 'never brought back');
      if (vertices) lowest = Math.min(lowest, ...vertices.filter((_, i) => i % 3 === 1));
    }
    assert.ok(-lowest > 0.9 * length, `a ${length} m rope hangs ${-lowest} m below its pin`);
  }
});
