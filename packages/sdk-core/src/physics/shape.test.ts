import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../contracts/cache.ts';
import { box, cylinder, plane, sphere } from '../world/geometry/basic.ts';
import { capsule } from '../world/geometry/round.ts';
import { Geometry } from '../world/geometry/geometry.ts';
import { BufferAttribute } from '../world/buffer/attribute.ts';
import { SHAPE } from './layout.ts';
import type { PhysicsShape } from './options.ts';
import { primitive, resolveShape, SCALE_TOLERANCE } from './shape.ts';

const one = { x: 1, y: 1, z: 1 };
const twice = { x: 2, y: 2, z: 2 };
const ball = { type: 'sphere', radius: 1 } as const;

/** A triangle and a stray vertex, indexed backwards or not indexed. */
function triangle(indexed = false) {
  const value = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([1, 2, 3, -2, 4, 5, 6, -3, 2, 9, 8, 7]), 3),
  );
  if (indexed) value.setIndex([2, 1, 0]);
  return value;
}
/** Asserts `run` refuses the shape as `PHYSICS_FAILED`, naming `name`; returns the message. */
function refused(run: () => unknown, name: string) {
  let message = '';
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof EngineError);
    assert.equal(error.code, 'PHYSICS_FAILED');
    assert.deepEqual(error.details, { name });
    assert.ok(error.message.includes(`"${name}"`), error.message);
    message = error.message;
    return true;
  });
  return message;
}
/** The geometry's extent along x, y and z. */
function extent(geometry: Geometry) {
  const { min, max } = geometry.computeBoundingBox();
  return [max.x - min.x, max.y - min.y, max.z - min.z];
}

test('the shape is the exact primitive a geometry was built as, scaled', () => {
  assert.deepEqual(resolveShape(box(2, 4, 6), { x: 2, y: 1, z: 1 }, 'dynamic').size, [2, 2, 3]);
  assert.equal(resolveShape(sphere(0.5), twice, 'dynamic').size[0], 1);
  const pill = resolveShape(capsule(0.3, 1), one, 'dynamic');
  assert.equal(pill.shape, SHAPE.capsule);
  assert.deepEqual(pill.size, [0.5, 0.3, 0]);
  // A cylinder tapers only when its bottom radius differs from its top's.
  const tapered = { type: 'cylinder', halfHeight: 1, radius: 0.2 } as const;
  const size = (radiusBottom?: number) =>
    resolveShape(box(), twice, 'dynamic', { ...tapered, radiusBottom }).size;
  assert.deepEqual(size(0.3), [2, 0.4, 0.6]);
  assert.deepEqual(size(0.2), [2, 0.4, 0]);
  assert.deepEqual(size(), [2, 0.4, 0]);
});

test('a primitive built with its default sizes or given ones fits the geometry drawn', () => {
  const s = 2;
  const scaled = { x: s, y: s, z: s };
  for (const geometry of [box(), box(2, 4, 6)]) {
    const fit = resolveShape(geometry, scaled, 'dynamic');
    assert.equal(fit.shape, SHAPE.box);
    assert.deepEqual(
      fit.size,
      extent(geometry).map((e) => (e / 2) * s),
    );
  }
  for (const geometry of [sphere(), sphere(3)]) {
    const fit = resolveShape(geometry, scaled, 'dynamic');
    assert.equal(fit.shape, SHAPE.sphere);
    assert.deepEqual(fit.size, [(extent(geometry)[1] / 2) * s, 0, 0]);
  }
  for (const geometry of [capsule(), capsule(0.3, 2)]) {
    const fit = resolveShape(geometry, scaled, 'dynamic');
    assert.equal(fit.shape, SHAPE.capsule);
    const [halfHeight, radius] = fit.size;
    // Its caps' centres and radius span the drawn height.
    assert.ok(Math.abs(halfHeight + radius - (extent(geometry)[1] / 2) * s) < 1e-9);
    assert.ok(halfHeight > 0 && radius > 0);
  }
  for (const geometry of [cylinder(), cylinder(3, 3, 4)]) {
    const fit = resolveShape(geometry, scaled, 'dynamic');
    const [x, y, z] = extent(geometry);
    assert.equal(fit.shape, SHAPE.cylinder);
    assert.deepEqual(fit.size, [(y / 2) * s, (Math.max(x, z) / 2) * s, 0]);
  }
  // A cone is no primitive the module tapers from its recipe: its hull, its triangles.
  assert.equal(resolveShape(cylinder(1, 2, 4), scaled, 'dynamic').shape, SHAPE.hull);
  const unknown = triangle();
  unknown.recipe = { type: 'torus', args: [] };
  assert.equal(resolveShape(unknown, scaled, 'static').shape, SHAPE.triangles);
});

test('a round primitive needs the scale that keeps it round; a box takes any, mirrored or not', () => {
  const uniform = { x: -2, y: 2, z: -2 };
  assert.deepEqual(primitive({ type: 'sphere', radius: 3 }, uniform)?.size, [6, 0, 0]);
  assert.deepEqual(
    primitive({ type: 'capsule', radius: 3, halfHeight: 4 }, uniform)?.size,
    [8, 6, 0],
  );
  const cone = { type: 'cylinder', radius: 3, radiusBottom: 5, halfHeight: 4 } as const;
  assert.deepEqual(primitive(cone, { x: 2, y: 7, z: 2 })?.size, [28, 6, 10], 'stretched along y');
  assert.deepEqual(primitive({ ...cone, radiusBottom: 3 }, uniform)?.size, [8, 6, 0]);
  assert.deepEqual(
    primitive({ type: 'box', halfExtents: [2, 3, 4] }, { x: -3, y: -4, z: -5 })?.size,
    [6, 12, 20],
  );
  for (const s of [
    { x: 2, y: 3, z: 2 },
    { x: 2, y: 2, z: 3 },
  ]) {
    assert.equal(primitive(ball, s), null);
    assert.equal(primitive({ type: 'capsule', radius: 1, halfHeight: 2 }, s), null);
  }
  assert.equal(primitive(cone, { x: 2, y: 2, z: 3 }), null);
});

test('a scale is uniform within its tolerance: relative past 1, absolute below', () => {
  const t = SCALE_TOLERANCE;
  for (const size of [1000, 1, 0]) {
    const at = (z: number) => primitive(ball, { x: size, y: size, z });
    const room = t * Math.max(1, size);
    assert.ok(at(size + room / 2), `${size}: within`);
    assert.ok(at(size + room), `${size}: at the tolerance`);
    assert.equal(at(size + room * 2), null, `${size}: past`);
  }
});

test('a compound places its primitives in the body, scaled', () => {
  const raft = resolveShape(box(), twice, 'dynamic', {
    type: 'compound',
    parts: [
      { type: 'box', halfExtents: [1, 0.1, 1], position: [0, 0.5, 0] },
      { type: 'cylinder', halfHeight: 1, radius: 0.2, quaternion: [0, 0, 0.6, 0.8] },
      { type: 'sphere', radius: 2, position: [3, 4, 5] },
    ],
  });
  assert.equal(raft.shape, SHAPE.compound);
  assert.deepEqual(raft.size, [0, 0, 0]);
  assert.equal(raft.triangles, 0);
  assert.deepEqual(raft.parts, [
    { shape: SHAPE.box, size: [2, 0.2, 2], position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    { shape: SHAPE.cylinder, size: [2, 0.4, 0], position: [0, 0, 0], quaternion: [0, 0, 0.6, 0.8] },
    { shape: SHAPE.sphere, size: [4, 0, 0], position: [6, 8, 10], quaternion: [0, 0, 0, 1] },
  ]);
});

test('a compound stretched, flattened or mirrored is refused naming its scale and the mesh', () => {
  const shape: PhysicsShape = { type: 'compound', parts: [ball] };
  const made = (s: { x: number; y: number; z: number }, name?: string) => () =>
    resolveShape(box(), s, 'dynamic', shape, name);
  for (const [x, y, z, mirrored] of [
    [0, 0, 0, false],
    [-1, 1, 0, false],
    [1, 2.5, 1, false],
    [1, 1, 2.5, false],
    [-1, -1, 1, false],
    [-1, 0, 1, false],
    [-1, -1, -1, true],
    [-1, 1, 1, true],
    [1, -1, 1, true],
    [1, 1, -1, true],
  ] as const) {
    const message = refused(made({ x, y, z }, 'raft'), 'raft');
    assert.ok(message.includes(`${x}, ${y}, ${z}`), message);
    assert.equal(/mirror/.test(message), mirrored, message);
    assert.equal(message.endsWith(`${x}, ${y}, ${z}.`), !mirrored, 'the scale said last');
  }
  // Below the tolerance a scale is uniform, never below 0.
  for (const axis of ['x', 'y', 'z'] as const)
    for (const value of [0, -1e-8]) refused(made({ x: 1e-8, y: 1e-8, z: 1e-8, [axis]: value }), '');
  assert.equal(
    refused(made({ x: 1, y: 2, z: 1 }), ''),
    refused(made({ x: 1, y: 2, z: 1 }, ''), ''),
  );
});

test('any other mesh is triangles when static and a hull when it moves', () => {
  const ground = resolveShape(plane(4, 4, 2, 2), one, 'static');
  assert.equal(ground.shape, SHAPE.triangles);
  assert.equal(ground.triangles, 8);
  const squashed = resolveShape(sphere(1, 8, 6), { x: 1, y: 0.5, z: 1 }, 'dynamic');
  assert.equal(squashed.shape, SHAPE.hull);
  assert.equal(squashed.triangles, 0);
});

test('a mesh collider carries its vertices scaled, mirror included, and only whole triangles', () => {
  const scale = { x: -2, y: 3, z: 4 };
  const scaled = [-2, 6, 12, 4, 12, 20, -12, -9, 8, -18, 24, 28];
  for (const indexed of [false, true]) {
    const geometry = triangle(indexed);
    const ground = resolveShape(geometry, scale, 'static');
    assert.equal(ground.shape, SHAPE.triangles);
    assert.deepEqual([...ground.vertices!], scaled);
    assert.deepEqual(
      [...ground.indices!],
      indexed ? [2, 1, 0] : [0, 1, 2],
      'the stray vertex left',
    );
    assert.equal(ground.triangles, 1);
    assert.deepEqual(ground.size, [0, 0, 0]);
    for (const type of ['dynamic', 'kinematic'] as const) {
      const hull = resolveShape(geometry, scale, type);
      assert.deepEqual(hull, {
        shape: SHAPE.hull,
        size: [0, 0, 0],
        vertices: ground.vertices,
        triangles: 0,
      });
    }
    assert.equal(resolveShape(geometry, scale, 'static', { type: 'hull' }).shape, SHAPE.hull);
    assert.equal(
      resolveShape(geometry, scale, 'kinematic', { type: 'triangles' }).shape,
      SHAPE.triangles,
    );
  }
});

test('a dynamic body declared as triangles is refused naming the mesh: triangles hold no mass', () => {
  const as = (name?: string) => () =>
    resolveShape(box(), one, 'dynamic', { type: 'triangles' }, name);
  refused(as('panel'), 'panel');
  assert.equal(refused(as(), ''), refused(as(''), ''), 'an unnamed mesh is named ""');
});
