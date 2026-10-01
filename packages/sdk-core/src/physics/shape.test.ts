import test from 'node:test';
import assert from 'node:assert/strict';
import { box, cylinder, plane, sphere } from '../world/geometry/basic.ts';
import { capsule } from '../world/geometry/round.ts';
import type { Geometry } from '../world/geometry/geometry.ts';
import { ball, one, refusedShape as refused, triangle, twice } from './shape.fixture.ts';
import { SHAPE } from './layout.ts';
import { primitive, resolveShape } from './shape.ts';

/** The geometry's extent along x, y and z. */
function extent(geometry: Geometry) {
  const { min, max } = geometry.computeBoundingBox();
  return [max.x - min.x, max.y - min.y, max.z - min.z];
}

test('the shape is the exact primitive a geometry was built as, scaled', () => {
  assert.deepEqual(resolveShape(box(2, 4, 6), { x: 2, y: 1, z: 1 }, 'dynamic').size, [2, 2, 3]);
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
  const s = twice.x;
  for (const geometry of [box(), box(2, 4, 6)]) {
    const fit = resolveShape(geometry, twice, 'dynamic');
    assert.equal(fit.shape, SHAPE.box);
    assert.deepEqual(
      fit.size,
      extent(geometry).map((e) => (e / 2) * s),
    );
  }
  for (const geometry of [sphere(), sphere(3)]) {
    const fit = resolveShape(geometry, twice, 'dynamic');
    assert.equal(fit.shape, SHAPE.sphere);
    assert.deepEqual(fit.size, [(extent(geometry)[1] / 2) * s, 0, 0]);
  }
  for (const geometry of [capsule(), capsule(0.3, 2)]) {
    const fit = resolveShape(geometry, twice, 'dynamic');
    assert.equal(fit.shape, SHAPE.capsule);
    const [halfHeight, radius] = fit.size;
    // Its caps' centres and radius span the drawn height.
    assert.ok(Math.abs(halfHeight + radius - (extent(geometry)[1] / 2) * s) < 1e-9);
    assert.ok(halfHeight > 0 && radius > 0);
  }
  for (const geometry of [cylinder(), cylinder(3, 3, 4)]) {
    const fit = resolveShape(geometry, twice, 'dynamic');
    const [x, y, z] = extent(geometry);
    assert.equal(fit.shape, SHAPE.cylinder);
    assert.deepEqual(fit.size, [(y / 2) * s, (Math.max(x, z) / 2) * s, 0]);
  }
  // A cone is no primitive the module tapers from its recipe: its hull, its triangles.
  assert.equal(resolveShape(cylinder(1, 2, 4), twice, 'dynamic').shape, SHAPE.hull);
  const unknown = triangle();
  unknown.recipe = { type: 'torus', args: [] };
  assert.equal(resolveShape(unknown, twice, 'static').shape, SHAPE.triangles);
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

/** How far past `size` the third component of a scale may go and the scale still keep a sphere
 *  round: found by halving, never read from the source. */
function room(size: number) {
  let [inside, outside] = [0, 1];
  for (let i = 0; i < 80; i++) {
    const mid = (inside + outside) / 2;
    if (primitive(ball, { x: size, y: size, z: size + mid })) inside = mid;
    else outside = mid;
  }
  return inside;
}

test('a scale is uniform within a rounding’s room: relative past 1, the same absolute below', () => {
  const [none, unit, large] = [room(0), room(1), room(1000)];
  assert.ok(none > 0, 'a vanishing scale has room too');
  assert.ok(unit < 0.01, `${unit}: a stretch of a hundredth is no rounding`);
  assert.ok(Math.abs(none - unit) <= unit * 1e-6, `${none} below 1 as at 1 (${unit})`);
  assert.ok(Math.abs(large / unit / 1000 - 1) < 1e-6, `${large} grows with the scale`);
});

test('any other mesh is triangles when static and a hull when it moves, its vertices scaled', () => {
  assert.equal(resolveShape(plane(4, 4, 2, 2), one, 'static').triangles, 8);
  const squashed = resolveShape(sphere(1, 8, 6), { x: 1, y: 0.5, z: 1 }, 'dynamic');
  assert.equal(squashed.shape, SHAPE.hull, 'no sphere once squashed');
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
