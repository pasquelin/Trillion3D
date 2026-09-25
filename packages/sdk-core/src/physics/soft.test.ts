import test from 'node:test';
import assert from 'node:assert/strict';
import { plane, sphere } from '../world/geometry/basic.ts';
import { fromArrays } from '../world/geometry/builder.ts';
import { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import { ObjectPhysics } from './objectPhysics.ts';
import {
  SOFT_AREAL_DENSITY,
  SOFT_FOOTPRINT,
  SOFT_LINEAR_DENSITY,
  softBodyOf,
  softSettings,
  type SoftBodyOptions,
} from './soft.ts';
import { writeSoft } from './softCommands.ts';
import { SOFT_VERTEX_WORDS, SOFT_WORDS } from './softLayout.ts';

const one = { x: 1, y: 1, z: 1 };
const masses = (vertices: Float32Array) => vertices.filter((_, i) => i % SOFT_VERTEX_WORDS === 3);
const sum = (values: Float32Array) => values.reduce((a, b) => a + b, 0);
const of = (options: SoftBodyOptions, scale = one, geometry = plane(2, 1, 4, 2)) =>
  softBodyOf(geometry, scale, softSettings(options));

test('a cloth weighs its scaled area times the fabric’s, or the mass it is given, spread by area', () => {
  const cloth = of({ type: 'cloth' });
  assert.ok(Math.abs(sum(masses(cloth.vertices)) - 2 * SOFT_AREAL_DENSITY) < 1e-6);
  assert.ok(
    Math.abs(sum(masses(of({ type: 'cloth' }, { x: 3, y: 1, z: 1 }).vertices)) - 1.2) < 1e-6,
  );
  const given = masses(of({ type: 'cloth', mass: 5 }).vertices);
  assert.ok(Math.abs(sum(given) - 5) < 1e-5);
  // A corner holds one triangle's third, an inner vertex six: they weigh so.
  assert.ok(given[0] < given[6]);
  assert.equal(cloth.pressure, 0, 'a cloth holds no gas');
});

test('pins weigh nothing, and a pin naming no vertex is refused', () => {
  const { vertices, map } = of({ type: 'cloth', pins: [0, 4] });
  assert.deepEqual(
    [0, 4].map((v) => vertices[map[v] * SOFT_VERTEX_WORDS + 3]),
    [0, 0],
  );
  assert.ok(vertices[map[1] * SOFT_VERTEX_WORDS + 3] > 0);
  assert.throws(() => of({ type: 'cloth', pins: [15] }), RangeError);
});

test('a sphere’s seam and poles are welded: one vertex per position, no degenerate triangle', () => {
  const ball = sphere(1, 8, 6);
  const { vertices, indices, map, pressure } = of({ type: 'volume' }, one, ball);
  assert.equal(vertices.length / SOFT_VERTEX_WORDS, 8 * 5 + 2);
  assert.equal(map.length, ball.getAttribute('position')!.count);
  for (let t = 0; t < indices.length; t += 3)
    assert.equal(new Set(indices.subarray(t, t + 3)).size, 3);
  // Its default pressure rests its weight on a quarter of its mean cross-section (area / 4).
  assert.ok(Math.abs(pressure - (4 * SOFT_AREAL_DENSITY * 9.81) / SOFT_FOOTPRINT) < 1e-6);
  assert.equal(of({ type: 'volume', pressure: 200 }, one, ball).pressure, 200);
  // Past what its skin holds within a tenth of its volume, a pressure is refused; a light fine
  // skin's default is capped there, below its weight's.
  assert.throws(() => of({ type: 'volume', pressure: 900 }, one, ball), RangeError);
  const fine = sphere(0.1, 32, 24);
  const held = of({ type: 'volume' }, one, fine).pressure;
  assert.ok(held < pressure, `${held} Pa`);
  assert.throws(() => of({ type: 'volume', pressure: held * 1.01 }, one, fine), RangeError);
  // An edge that gives holds less, and one that is not there holds none.
  assert.ok(of({ type: 'volume', stretch: 1e-3 }, one, fine).pressure < held);
  assert.equal(of({ type: 'volume', stretch: Infinity }, one, ball).pressure, 0);
});

test('a rope is its vertices in order, weighing its length times the rope’s', () => {
  const rope = of({ type: 'rope' }, one, fromArrays([0, 0, 0, 1, 0, 0, 1, 2, 0], [], [], []));
  assert.equal(rope.indices.length, 0);
  const each = [0.5, 1.5, 1].map((metres) => metres * SOFT_LINEAR_DENSITY);
  masses(rope.vertices).forEach((kg, i) => assert.ok(Math.abs(kg - each[i]) < 1e-6));
  assert.throws(() => of({ type: 'rope' }, one, plane(0, 0, 1, 1)), { code: 'PHYSICS_FAILED' });
});

test('soft options out of range are refused, and a soft body keeps its type and settings', () => {
  for (const bad of [{ stretch: -1 }, { bend: Number.NaN }, { mass: -2 }, { pressure: -5 }])
    assert.throws(() => new ObjectPhysics({ type: 'volume', ...bad }), RangeError);
  // What Jolt's soft bodies cannot take is refused, never dropped.
  const rigid = [{ shape: 'box' }, { sensor: true }, { ccd: false }, { decorative: true }];
  for (const bad of [...rigid, { damping: { angular: 0.1 } }])
    assert.throws(
      () => new ObjectPhysics({ type: 'cloth', ...bad } as SoftBodyOptions),
      RangeError,
    );
  const body = new ObjectPhysics({ type: 'cloth', pins: [1] });
  assert.equal(body.type, 'cloth');
  assert.deepEqual(body.soft, {
    type: 'cloth',
    pins: [1],
    mass: undefined,
    stretch: 0,
    bend: Infinity,
    pressure: 0,
  });
  assert.equal(new ObjectPhysics('dynamic').soft, null);
});

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
  assert.deepEqual([words[19], words[20]], [4, 6]);
  assert.deepEqual([...floats.subarray(SOFT_WORDS, SOFT_WORDS + 16)], [...record.vertices]);
  assert.deepEqual([...words.subarray(SOFT_WORDS + 16)], [...record.indices]);
});
