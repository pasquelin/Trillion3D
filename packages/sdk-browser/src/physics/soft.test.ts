import test from 'node:test';
import assert from 'node:assert/strict';
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts';
import type { SoftBodyOptions } from '../../../sdk-core/src/physics/index.ts';
import { addSoft, at, ropeLine, settle, softWorld } from './soft.fixture.ts';

/** Laid flat: the plane's `+y` turned to the world's `−z`, so its `−z` is the world's down. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** A cloth of 1 m, 10 × 10 squares, and its rows of 11 vertices from `y = −0.5`. */
const cloth = () => plane(1, 1, 10, 10);
const row = (r: number) => Array.from({ length: 11 }, (_, i) => r * 11 + i);
const ropeLength = (v: Float32Array, count: number) =>
  Array.from({ length: count - 1 }, (_, i) =>
    Math.hypot(...at(v, i + 1).map((x, k) => x - at(v, i)[k])),
  ).reduce((a, b) => a + b);

/** The volume of a closed geometry's triangles at `vertices`. */
function volumeOf(indices: ArrayLike<number>, v: Float32Array) {
  let six = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [at(v, indices[t]), at(v, indices[t + 1]), at(v, indices[t + 2])];
    six += a[0] * (b[1] * c[2] - b[2] * c[1]);
    six += a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return six / 6;
}

/** A 0.5 m ball dropped on the floor, after 3 s: its volume over its rest volume. */
async function ball(options: Omit<Extract<SoftBodyOptions, { type: 'volume' }>, 'type'>) {
  const jolt = await softWorld();
  const shape = sphere(0.5, 16, 12);
  const rest = volumeOf(shape.index!.array, shape.getAttribute('position')!.array as Float32Array);
  const record = addSoft(jolt, shape, { type: 'volume', ...options }, [0, 1, 0]);
  return volumeOf(shape.index!.array, settle(jolt, record, 3)) / rest;
}

test('a pinned cloth laid flat swings down and hangs from its pins, and falls without them', async () => {
  const jolt = await softWorld();
  const pins = row(10);
  const record = addSoft(jolt, cloth(), { type: 'cloth', pins }, [0, 3, 0], {
    quaternion: FLAT,
    linearDamping: 2,
  });
  assert.equal(jolt.step(null, 1 / 60), 0, 'a soft body sends no rigid pose');
  assert.ok(jolt.active() > 0, 'a moving soft body keeps the worker stepping');
  const hung = settle(jolt, record, 3);
  for (const pin of pins) assert.ok(Math.abs(at(hung, pin)[1] - 0.5) < 1e-4, `pin ${pin} held`);
  // The far edge hangs a metre below the pins: the geometry's −z is the world's down.
  for (const v of row(0)) assert.ok(at(hung, v)[2] < -0.9, `vertex ${v} hangs, ${at(hung, v)}`);
  const free = await softWorld();
  const unpinned = addSoft(free, cloth(), { type: 'cloth' }, [0, 3, 0], { quaternion: FLAT });
  assert.ok(at(settle(free, unpinned, 1), pins[0])[2] < -2.9, 'without pins it falls to the floor');
});

test('a rope pinned at one end keeps its length as it swings; given stretch, it gives', async () => {
  const swing = async (stretch?: number) => {
    const jolt = await softWorld();
    const record = addSoft(jolt, ropeLine(21, 2), { type: 'rope', pins: [0], stretch }, [0, 3, 0]);
    return settle(jolt, record, 3);
  };
  const rope = await swing();
  assert.ok(Math.abs(ropeLength(rope, 21) - 2) < 0.06, `length ${ropeLength(rope, 21)}`);
  assert.deepEqual(at(rope, 0), [0, 0, 0], 'the pinned end stays');
  assert.ok(at(rope, 20)[1] < -1, 'the free end swung down');
  assert.ok(ropeLength(await swing(0.05), 21) > 2.2, 'a rope that gives stretches');
});

test('a volume keeps its volume on the floor, by its gas: without, or too heavy, it slumps', async () => {
  const kept = await ball({});
  assert.ok(Math.abs(kept - 1) < 0.1, `volume ${kept} of its rest`);
  assert.ok((await ball({ pressure: 0 })) < 0.6, 'no gas, it slumps');
  assert.ok((await ball({ pressure: 31, mass: 50 })) < 0.8, 'too heavy for its gas, it slumps');
});

test('a cloth bent stiff stays out flat from its pins; folding freely, it hangs', async () => {
  const reach = async (bend: number) => {
    const jolt = await softWorld();
    const options = { type: 'cloth' as const, pins: [...row(10), ...row(9)], bend };
    const record = addSoft(jolt, cloth(), options, [0, 3, 0], {
      quaternion: FLAT,
      linearDamping: 2,
    });
    return at(settle(jolt, record, 3), 5)[2];
  };
  assert.ok((await reach(0)) > -0.3, 'stiff, it stays out');
  assert.ok((await reach(Infinity)) < -0.8, 'free, it hangs');
});

test('SOFT reads gravity scale, damping and friction where the layout puts them', async () => {
  const drop = async (words: object, seconds = 0.5) => {
    const jolt = await softWorld();
    return at(
      settle(jolt, addSoft(jolt, cloth(), { type: 'cloth' }, [0, 3, 0], words), seconds),
      0,
    );
  };
  assert.ok(Math.abs((await drop({ gravityScale: 0 }))[1] + 0.5) < 1e-3, 'no gravity, it floats');
  assert.ok((await drop({ linearDamping: 20 }))[1] > -0.5 - 0.3, 'damped, it falls slowly');
  assert.ok((await drop({}))[1] < -0.5 - 1, 'undamped, it falls freely');
  // On a floor tilted 30°, a flat cloth slides unless it grips (tan 30° < √(0.5 · 1)).
  const slope = async (friction: number) => {
    const jolt = await softWorld([0, 0, Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)]);
    const record = addSoft(jolt, plane(0.5, 0.5, 4, 4), { type: 'cloth' }, [0, 0.35, 0], {
      quaternion: FLAT,
      friction,
    });
    return at(settle(jolt, record, 1), 12)[0];
  };
  assert.ok(Math.abs(await slope(1)) < 0.1, 'it grips');
  assert.ok(Math.abs(await slope(0)) > 0.5, 'it slides');
});

test('a soft body at rest falls asleep: written one last time, then no more', async () => {
  const jolt = await softWorld();
  addSoft(jolt, sphere(0.5, 16, 12), { type: 'volume' }, [0, 1, 0]);
  let steps = 0;
  while (jolt.active() > 0 && steps++ < 1800) {
    jolt.step(null, 1 / 60);
    assert.ok(jolt.soft().length > 0, 'awake or just asleep, it is written');
  }
  assert.equal(jolt.active(), 0, 'it sleeps');
  jolt.step(null, 1 / 60);
  assert.equal(jolt.soft().length, 0, 'asleep, it is written no more');
});
