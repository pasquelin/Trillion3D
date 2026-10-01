import test from 'node:test';
import assert from 'node:assert/strict';
import { object } from './index.ts';
import { material } from '../material/index.ts';
import { Geometry } from '../geometry/geometry.ts';
import { BufferAttribute } from '../buffer/attribute.ts';
import { drawnTriangles } from '../geometry/drawn.ts';

/** Four corners of a unit square, in order round it. */
const square = () =>
  new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3),
  );

test('each family member reads four corners as its name says: dots, a strip, pairs or a loop', () => {
  // A segment or a dot is drawn as quads of two triangles; a dot as a small solid.
  const quads = (mesh: ReturnType<typeof object.line>) =>
    drawnTriangles(mesh.geometry, mesh.primitive)!.indices.length / 6;
  assert.equal(quads(object.line(square())), 3);
  assert.equal(quads(object.lineSegments(square())), 2);
  assert.equal(quads(object.lineLoop(square())), 4);
  const dot = new Geometry().setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  const triangles = (mesh: ReturnType<typeof object.points>) =>
    drawnTriangles(mesh.geometry, mesh.primitive)!.indices.length;
  assert.equal(triangles(object.points(square())), 4 * triangles(object.points(dot)), 'four dots');
});

test('each member wears, unless told otherwise, the material kind of what it draws', () => {
  assert.equal(object.mesh(square()).material.kind, material.meshBasic().kind);
  assert.equal(object.points(square()).material.kind, material.points().kind);
  for (const make of [object.line, object.lineSegments, object.lineLoop])
    assert.equal(make(square()).material.kind, material.line().kind);
});
