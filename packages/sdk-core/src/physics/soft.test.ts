import test from 'node:test';
import assert from 'node:assert/strict';
import { plane, sphere } from '../world/geometry/basic.ts';
import { fromArrays } from '../world/geometry/builder.ts';
import { InterleavedBuffer, InterleavedBufferAttribute } from '../world/buffer/attribute.ts';
import { refuses } from '../contracts/cache.fixture.ts';
import { near } from '../math/near.fixture.ts';
import { positions } from './geometry.fixture.ts';
import { GRAVITY_PRESETS } from './options.ts';
import {
  isSoftType,
  softOf,
  SOFT_AREAL_DENSITY,
  SOFT_FOOTPRINT,
  SOFT_LINEAR_DENSITY,
  softBodyOf,
  type SoftBodyOptions,
} from './soft.ts';
import { SOFT_VERTEX_WORDS } from './softLayout.ts';
import { softSettings } from './softSettings.ts';

const one = { x: 1, y: 1, z: 1 };
const masses = (vertices: Float32Array) => vertices.filter((_, i) => i % SOFT_VERTEX_WORDS === 3);
const sum = (values: Float32Array) => values.reduce((a, b) => a + b, 0);
const of = (options: SoftBodyOptions, scale = one, geometry = plane(2, 1, 4, 2)) =>
  softBodyOf(geometry, scale, softSettings(options));

test('a cloth weighs its scaled area times the fabric’s, or the mass it is given, spread by area', () => {
  const cloth = of({ type: 'cloth' });
  near([sum(masses(cloth.vertices))], [2 * SOFT_AREAL_DENSITY], '2 m²', 1e-6);
  const wide = of({ type: 'cloth' }, { x: 3, y: 1, z: 1 });
  near([sum(masses(wide.vertices))], [6 * SOFT_AREAL_DENSITY], '6 m² scaled', 1e-6);
  const given = masses(of({ type: 'cloth', mass: 5 }).vertices);
  near([sum(given)], [5], 'given', 1e-5);
  // A corner holds one triangle's third, an inner vertex six: they weigh so.
  assert.ok(given[0] < given[6]);
  assert.equal(cloth.pressure, 0, 'a cloth holds no gas');
});

test('pins weigh nothing, the vertices around them something', () => {
  const { vertices, map } = of({ type: 'cloth', pins: [0, 4] });
  assert.deepEqual(
    [0, 4].map((v) => vertices[map[v] * SOFT_VERTEX_WORDS + 3]),
    [0, 0],
  );
  assert.ok(vertices[map[1] * SOFT_VERTEX_WORDS + 3] > 0);
});

test('a sphere’s seam and poles are welded: one vertex per position, no degenerate triangle', () => {
  const ball = sphere(1, 8, 6);
  const { vertices, indices, map, pressure } = of({ type: 'volume' }, one, ball);
  assert.equal(vertices.length / SOFT_VERTEX_WORDS, 8 * 5 + 2);
  assert.equal(map.length, ball.getAttribute('position')!.count);
  for (let t = 0; t < indices.length; t += 3)
    assert.equal(new Set(indices.subarray(t, t + 3)).size, 3);
  // Its default pressure bears its weight on `SOFT_FOOTPRINT` of its mean cross-section, a
  // quarter of its area for a convex body (Cauchy); its skin weighs its area times the fabric's.
  const mass = sum(masses(vertices));
  const area = mass / SOFT_AREAL_DENSITY;
  near([pressure * SOFT_FOOTPRINT * (area / 4)], [mass * GRAVITY_PRESETS.earth], 'weight', 1e-6);
  assert.equal(of({ type: 'volume', pressure: 200 }, one, ball).pressure, 200);
  // Past what its skin holds within a tenth of its volume, a pressure is refused; a light fine
  // skin's default is capped there, below its weight's.
  assert.throws(
    () => of({ type: 'volume', pressure: 900 }, one, ball),
    (error: unknown) => error instanceof RangeError && error.message.includes('900'),
  );
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
  near(masses(rope.vertices), each, 'by length', 1e-6);
  assert.throws(() => of({ type: 'rope' }, one, plane(0, 0, 1, 1)), { code: 'PHYSICS_FAILED' });
});

test('a cloth over an interleaved position reads its vertices, not the whole shared buffer', () => {
  const flat = plane(2, 1, 4, 2);
  const position = flat.getAttribute('position')!;
  const packed = new Float32Array(position.count * 5);
  for (let i = 0; i < position.count; i++)
    for (let c = 0; c < 3; c++) packed[i * 5 + c] = position.getComponent(i, c);
  const woven = flat.clone();
  woven.setAttribute(
    'position',
    new InterleavedBufferAttribute(new InterleavedBuffer(packed, 5), 3, 0),
  );
  assert.deepEqual(of({ type: 'cloth' }, one, woven).vertices, of({ type: 'cloth' }).vertices);
});

/** Asserts `run` refuses the soft body as `PHYSICS_FAILED`, saying why, naming `named`. */
const failed = (run: () => unknown, named?: string) =>
  refuses(run, 'PHYSICS_FAILED', undefined, named ? [named] : []);

test('an option names a soft body by its type alone; a rigid one is none', () => {
  for (const type of ['cloth', 'rope', 'volume']) {
    assert.equal(isSoftType(type), true);
    assert.equal(softOf({ type } as SoftBodyOptions)?.type, type);
  }
  for (const type of ['dynamic', 'static', undefined, 'ROPE'])
    assert.equal(isSoftType(type), false, `${type}`);
  assert.equal(softOf('dynamic'), null);
  assert.equal(softOf({ type: 'dynamic' }), null);
  assert.equal(softOf({}), null);
});

test('a rope of two vertices shares its mass between them; it has no triangles nor gas', () => {
  const rope = of({ type: 'rope', mass: 4 }, one, positions([0, 0, 0, 0, 0, 2]));
  assert.deepEqual([...masses(rope.vertices)], [2, 2]);
  assert.equal(rope.indices.length, 0);
  assert.equal(rope.pressure, 0);
  // Three loose vertices, unindexed, are a rope's three, never a triangle of them.
  const bent = of({ type: 'rope', mass: 3 }, one, positions([0, 0, 0, 1, 0, 0, 1, 1, 0]));
  assert.equal(bent.indices.length, 0);
  assert.deepEqual([...masses(bent.vertices)], [0.75, 1.5, 0.75], 'by the length each holds');
  for (const type of ['rope', 'cloth'] as const)
    failed(() => of({ type }, one, positions([0, 0, 0])), type);
});

test('welding drops every triangle it folds, never a whole neighbour', () => {
  const folded = positions([0, 0, 0, 2, 0, 0, 0, 3, 0], [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 2]);
  const cloth = of({ type: 'cloth', mass: 9 }, one, folded);
  assert.deepEqual([...cloth.indices], [0, 1, 2]);
  assert.deepEqual([...masses(cloth.vertices)], [3, 3, 3], 'one triangle: a third each');
  // A trailing pair of corners makes no triangle.
  const trailing = positions([0, 0, 0, 2, 0, 0, 0, 3, 0], [0, 1, 2, 0, 1]);
  assert.deepEqual([...of({ type: 'cloth' }, one, trailing).indices], [0, 1, 2]);
  failed(
    () => of({ type: 'cloth' }, one, positions([0, 0, 0, 2, 0, 0, 0, 3, 0], [0, 0, 1])),
    'cloth',
  );
  failed(() => of({ type: 'cloth' }, one, positions([0, 0, 0, 1, 0, 0, 2, 0, 0])), '');
});

test('a pin names a whole vertex of the geometry, or is refused naming it', () => {
  const flat = positions([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  for (const pin of [-1, 0.5, NaN, 3])
    assert.throws(
      () => of({ type: 'cloth', pins: [pin] }, one, flat),
      (error: unknown) => error instanceof RangeError && error.message.includes(String(pin)),
    );
  assert.equal(masses(of({ type: 'cloth', pins: [2] }, one, flat).vertices)[2], 0);
});

test('an open cloth holds no gas, even given a pressure', () => {
  const settings = softSettings({ type: 'cloth' });
  settings.pressure = 1;
  assert.throws(
    () => softBodyOf(positions([0, 0, 0, 2, 0, 0, 0, 3, 0]), one, settings),
    RangeError,
  );
});
