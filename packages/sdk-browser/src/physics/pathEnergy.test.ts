import test from 'node:test';
import assert from 'node:assert/strict';
import { joint, type JointMotor } from '../../../sdk-core/src/physics/index.ts';
import { energiesOverALap, G, gap, jointRig } from './joints.fixture.ts';

test('a body on a frictionless vertical loop keeps its energy over a lap, to within a step of gravity', async () => {
  const R = 5,
    N = 64;
  const loop = Array.from({ length: N }, (_, i): [number, number, number] => {
    const a = (i / N) * 2 * Math.PI;
    return [R * Math.sin(a), R + 1 - R * Math.cos(a), 0];
  });
  // Fast enough to go over the top: v² > 4·g·R at the bottom.
  const { drift, fastest, lapped } = await energiesOverALap(loop, 16);
  assert.ok(lapped, 'round the loop within a minute');
  // The step's own error: gravity's work over one step, measured at the fastest speed (g·v·dt).
  const tolerance = (G * fastest) / 60;
  assert.ok(drift < tolerance, `energy off by ${drift} J/kg over a lap, ${tolerance} allowed`);
});

/** A level ring of radius 5 m, 64 points, 1 m up, from the origin along +x. */
const RING = Array.from({ length: 64 }, (_, i): [number, number, number] => {
  const a = (i / 64) * 2 * Math.PI;
  return [5 * Math.sin(a), 1, 5 - 5 * Math.cos(a)];
});

/** A level body of 100 kg with no damping unless told, held on `path`, launched along +x. */
function held(
  rig: Awaited<ReturnType<typeof jointRig>>,
  path: [number, number, number][],
  loop: boolean,
  damping = 0,
) {
  const body = rig.cube(...path[0]);
  body.physics = { type: 'dynamic', mass: 100, damping: { linear: damping, angular: 0 } };
  const made = joint.path(body, null, { path, loop, follow: false });
  rig.wanted.add(made);
  return { body, made };
}

/**
 * Twin bodies launched at `speed` in one rig, gravity doing no work on either: one round the
 * level ring, one along a straight level track. After `seconds`, each one's distance (sum of
 * chords) and fastest chord speed: the ring's bends must cost nothing the straight does not.
 */
async function twins(speed: number, seconds: number, damping: number, motor?: JointMotor) {
  const rig = await jointRig([0, -G, 0]);
  const made = [
    held(rig, RING, true, damping),
    held(
      rig,
      [
        [0, 1, -20],
        [400, 1, -20],
      ],
      false,
      damping,
    ),
  ];
  for (const { made: m } of made) if (motor) m.motor = motor;
  rig.run(1);
  for (const { body } of made) rig.writer.velocity(body.physics!._index, [speed, 0, 0]);
  const before = made.map(({ body }) => rig.at(body));
  const travelled = [0, 0],
    fastest = [0, 0];
  for (let s = 0; s < seconds * 60; s++) {
    rig.run(1);
    made.forEach(({ body }, i) => {
      const at = rig.at(body),
        step = gap(at, before[i]);
      travelled[i] += step;
      fastest[i] = Math.max(fastest[i], step * 60);
      before[i] = at;
    });
  }
  return { travelled, fastest };
}

// Two runs of one motion differ by at most a step's travel, v·dt: the tolerance below.
test('a braked body on a bend stops where it stops on a straight track', async () => {
  // 1 m/s² of brake from 10 m/s: 50 m (5.5 m short of it without the bends turning the body).
  const { travelled } = await twins(10, 15, 0, { mode: 'velocity', target: 0, maxForce: 100 });
  assert.ok(Math.abs(travelled[0] - travelled[1]) < 10 / 60, `stopped after ${travelled}`);
});

test('a motor drives a body round a bend to its speed, never past it', async () => {
  const { travelled, fastest } = await twins(0, 12, 0, {
    mode: 'velocity',
    target: 8,
    maxForce: 100,
  });
  assert.ok(fastest[0] <= fastest[1], `at most the straight's ${fastest[1]} m/s: ${fastest[0]}`);
  assert.ok(Math.abs(travelled[0] - travelled[1]) < 8 / 60, `ran ${travelled}`);
});

test('a damped body on a bend slows as it does on a straight track', async () => {
  const { travelled } = await twins(10, 4, 0.25);
  assert.ok(Math.abs(travelled[0] - travelled[1]) < 10 / 60, `ran ${travelled}`);
});

test('a body run into the end of an open bend stops there and stays', async () => {
  const rig = await jointRig([0, -G, 0]);
  const arc = RING.slice(0, 17);
  const { body } = held(rig, arc, false);
  rig.run(1);
  rig.writer.velocity(body.physics!._index, [5, 0, 0]);
  // 7.9 m of quarter ring at 5 m/s: there within 2 s.
  rig.run(120);
  for (let s = 0; s < 60; s++) {
    rig.run(1);
    assert.ok(gap(rig.at(body), arc[16]) < 1e-3, `held at the end: ${rig.at(body)}`);
  }
});
