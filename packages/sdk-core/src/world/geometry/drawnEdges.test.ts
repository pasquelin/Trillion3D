import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from './geometry.ts';
import { BufferAttribute, pendingAttribute } from '../buffer/attribute.ts';
import { drawnTriangles, readList } from './drawn.ts';

const position = (values: number[]) => new BufferAttribute(new Float32Array(values), 3);

test('empty pending positions draw nothing without demanding unavailable vertex storage', () => {
  const g = new Geometry().setAttribute(
    'position',
    pendingAttribute(
      {
        length: 0,
        type: 'Float32Array',
        read: async () => new Float32Array(),
      },
      3,
      false,
    ),
  );
  for (const primitive of ['triangles', 'points', 'lineStrip', 'sprite'] as const)
    assert.equal(drawnTriangles(g, primitive), null);
});

test('attribute extraction leaves a caller-provided tail untouched', () => {
  const g = new Geometry().setAttribute('normal', position([1, 2, 3, 4, 5, 6]));
  const out = new Float32Array(9).fill(99);
  assert.equal(readList(g, 'normal', 3, 2, out), out);
  assert.deepEqual(Array.from(out), [1, 2, 3, 4, 5, 6, 99, 99, 99]);
  out.fill(77);
  assert.equal(readList(g, 'normal', 3, 0, out), out);
  assert.deepEqual(Array.from(out), Array(9).fill(77));
});

test('ordinary points and lines omit deformation lookup and dash storage', () => {
  const g = new Geometry().setAttribute('position', position([0, 0, 0, 3, 4, 0]));
  for (const primitive of ['points', 'lineSegments'] as const) {
    const drawn = drawnTriangles(g, primitive)!;
    assert.equal(drawn.sourceVertices, undefined);
    assert.equal(drawn.deformation, undefined);
    assert.equal(drawn.uvs, null);
  }
  const dashed = drawnTriangles(g, 'lineLoop', { dashed: true })!;
  assert.deepEqual(Array.from(dashed.uvs!), [0, 0, 0, 0, 5, 0, 5, 0]);
});

test('loop quads use unit signed tangents, independent triangle indices and cumulative dash lengths', () => {
  const g = new Geometry().setAttribute('position', position([0, 0, 0, 3, 4, 0, 3, 4, 12]));
  g.morphAttributes.position = [position([1, 0, 0, 4, 4, 0, 4, 4, 12])];
  const drawn = drawnTriangles(g, 'lineLoop', { dashed: true })!;
  assert.deepEqual(
    Array.from(drawn.indices),
    [0, 1, 3, 0, 3, 2, 4, 5, 7, 4, 7, 6, 8, 9, 11, 8, 11, 10],
  );
  assert.deepEqual(
    Array.from(drawn.uvs!),
    [0, 0, 0, 0, 5, 0, 5, 0, 5, 0, 5, 0, 17, 0, 17, 0, 17, 0, 17, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(Array.from(drawn.sourceVertices!), [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0]);
  const tangents = [
    [0.6, 0.8, 0],
    [0, 0, 1],
    [-3 / 13, -4 / 13, -12 / 13],
  ];
  for (let segment = 0; segment < 3; segment++)
    for (let corner = 0; corner < 4; corner++)
      for (let c = 0; c < 3; c++) {
        const value = drawn.normals[segment * 12 + corner * 3 + c];
        assert.ok(Math.abs(value - tangents[segment][c] * (corner % 2 ? -1 : 1)) < 1e-7);
      }
});

test('wireframe dash distances continue through every edge and empty line meshes stay empty', () => {
  const g = new Geometry().setAttribute('position', position([0, 0, 0, 3, 0, 0, 0, 4, 0]));
  const wire = drawnTriangles(g, 'triangles', { wireframe: true, dashed: true })!;
  assert.equal(wire.lines, true);
  assert.equal(Math.max(...wire.uvs!), 12);
  assert.equal(wire.uvs![wire.uvs!.length - 2], 12);
  for (const vertices of [
    [1, 2, 3],
    [1, 2, 3, 1, 2, 3],
  ]) {
    const empty = new Geometry().setAttribute('position', position(vertices));
    assert.equal(drawnTriangles(empty, 'lineSegments'), null);
  }
});
