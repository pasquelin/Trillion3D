import test from 'node:test';
import assert from 'node:assert/strict';
import { object, raycast } from './index.ts';
import { geometry } from '../geometry/index.ts';
import { Ray } from '../math/volumes.ts';
import { Vector3 } from '../math/vector3.ts';
import { Camera } from '../camera/camera.ts';
import { Box3 } from '../math/box3.ts';
import { Object3D } from './object3d.ts';

const down = (x: number, z: number) => new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('a ray hits the nearest face of a mesh, and misses beside it', () => {
  const box = object.mesh(geometry.box(2, 2, 2));
  const [hit] = raycast(box, down(0.5, 0.5));
  assert.equal(hit.object, box);
  assert.ok(near(hit.distance, 9) && near(hit.point.y, 1));
  assert.ok(near(hit.normal.y, 1), "the face's outward normal");
  assert.equal(raycast(box, down(1.5, 0)).length, 0);
});

test('nested transforms place the hit in the world, nearest object first', () => {
  const parent = object.group(),
    child = object.mesh(geometry.box(1, 1, 1)),
    below = object.mesh(geometry.box(1, 1, 1));
  parent.position.set(5, 0, 0);
  parent.scale.set(2, 2, 2);
  child.position.set(1, 1, 0); // world centre (7, 2, 0), half size 1
  child.rotation.z = Math.PI / 2;
  below.position.set(7, -3, 0);
  parent.add(child);
  const hits = raycast([parent, below], down(7, 0));
  assert.deepEqual(
    hits.map((hit) => hit.object),
    [child, below],
  );
  assert.ok(near(hits[0].point.y, 3) && near(hits[0].distance, 7));
  assert.ok(near(hits[0].normal.y, 1), 'the world normal, through the parent scale and turn');
  child.visible = false;
  assert.deepEqual(
    raycast(parent, down(7, 0)).map((hit) => hit.object),
    [],
  );
});

test('lines are never hit; a camera ray through the centre goes down the view', () => {
  const line = object.lineSegments(geometry.box(4, 4, 4));
  assert.equal(raycast(line, down(0, 0)).length, 0);
  const camera = new Camera('perspective');
  camera.position.set(0, 0, 5);
  const ray = camera.rayThrough(0, 0, 1);
  assert.deepEqual(ray.direction.toArray(), [0, 0, -1]);
  const [hit] = raycast(object.mesh(geometry.box(1, 1, 1)), ray);
  assert.ok(near(hit.distance, 4.5));
});

test('a root under a hidden ancestor is never hit', () => {
  const hidden = object.group(),
    box = object.mesh(geometry.box(2, 2, 2));
  hidden.add(box);
  hidden.visible = false;
  assert.equal(raycast(box, down(0, 0)).length, 0);
});

test('a ray of any length gives distances in world units', () => {
  const long = new Ray(new Vector3(0, 10, 0), new Vector3(0, -4, 0));
  const [hit] = raycast(object.mesh(geometry.box(2, 2, 2)), long);
  assert.ok(near(hit.distance, 9) && near(hit.point.y, 1));
});

test('a box-only node is hit where the ray enters it, or at the origin from inside', () => {
  /** A node that has a box and no triangles: what a loaded model is to the CPU. */
  class Boxed extends Object3D {
    override localBounds() {
      return new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    }
  }
  const model = new Boxed();
  assert.ok(near(raycast(model, down(0, 0))[0].distance, 9), 'entered at the top face');
  const [inside] = raycast(model, new Ray(new Vector3(0, 0.5, 0), new Vector3(0, -1, 0)));
  assert.ok(near(inside.distance, 0) && near(inside.point.y, 0.5), 'the origin, not the far side');
  assert.ok(near(inside.normal.y, 1), 'the normal faces back along the ray');
});

/** The walk #368 shipped, frozen as the oracle: Möller–Trumbore over every triangle, in order. */
function bruteForce(p: ArrayLike<number>, index: ArrayLike<number>, o: Vector3, d: Vector3) {
  let best = -1,
    face = -1;
  for (let f = 0; f < index.length / 3; f++) {
    const [a, b, c] = [0, 1, 2].map((k) => index[f * 3 + k] * 3);
    const e1 = new Vector3(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    const e2 = new Vector3(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
    const q = d.clone().cross(e2),
      det = e1.dot(q);
    if (det === 0) continue;
    const s = o.clone().sub(new Vector3(p[a], p[a + 1], p[a + 2]));
    const u = s.dot(q) / det,
      r = s.clone().cross(e1),
      v = d.dot(r) / det,
      t = e2.dot(r) / det;
    if (u < 0 || u > 1 || v < 0 || u + v > 1 || t < 0) continue;
    if (best < 0 || t < best) [best, face] = [t, f];
  }
  return { distance: best, face };
}

test('the triangle tree finds the hits the brute-force walk found, face for face', () => {
  const knot = object.mesh(geometry.torusKnot(1, 0.3, 64, 12));
  knot.position.set(0.3, -0.2, 0.1);
  knot.rotation.set(0.4, 0.2, 0);
  knot.updateWorldMatrix(true, false);
  const shape = knot.geometry;
  const p = shape.attributes.position.array,
    index = shape.index!.array;
  const inverse = knot.matrixWorld.clone().invert();
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const origin = new Vector3(Math.sin(i) * 4, Math.cos(i * 1.3) * 4, 5);
    const aim = new Vector3(Math.sin(i * 0.7), Math.cos(i * 0.9), 0).multiplyScalar(1.2);
    const ray = new Ray(origin, aim.sub(origin).normalize());
    const [hit] = raycast(knot, ray);
    const o = origin.clone().applyMatrix4(inverse),
      d = origin.clone().add(ray.direction).applyMatrix4(inverse).sub(o);
    const expected = bruteForce(p, index, o, d);
    assert.equal(hit?.face ?? -1, expected.face, `ray ${i}`);
    if (hit) assert.ok(Math.abs(hit.distance - expected.distance) < 1e-5, `ray ${i}`);
    if (hit) hits++;
  }
  assert.ok(hits > 100, `enough rays hit (${hits})`);
});
