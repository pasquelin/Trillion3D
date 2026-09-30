import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from './geometry.ts';
import { BufferAttribute } from '../buffer/attribute.ts';
import { drawnTriangles, readList, lineCorners } from './drawn.ts';

const attr = (values: number[], width: number) =>
  new BufferAttribute(new Float32Array(values), width);

test('drawn triangles preserve attributes, pad alpha and omit incomplete triangles', () => {
  const g = new Geometry().setAttribute('position', attr([1, 2, 3, 4, 2, 3, 1, 6, 3, 7, 8, 9], 3));
  g.setAttribute('normal', attr([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', attr([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setAttribute('color', attr([1, 0, 0, 0, 1, 0, 0, 0, 1, 0.5, 0.5, 0.5], 3));
  const drawn = drawnTriangles(g, 'triangles')!;
  assert.deepEqual([...drawn.indices], [0, 1, 2]);
  assert.deepEqual([...drawn.positions], [1, 2, 3, 4, 2, 3, 1, 6, 3, 7, 8, 9]);
  assert.deepEqual([...drawn.normals], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual([...drawn.uvs!], [0, 0, 1, 0, 0, 1, 1, 1]);
  assert.deepEqual([...drawn.colors!], [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0.5, 0.5, 0.5, 1]);
  const out = new Float32Array(16).fill(99);
  assert.equal(readList(g, 'color', 4, 4, out), out);
  assert.deepEqual(out, drawn.colors);
  assert.equal(readList(g, 'missing', 3, 4), null);
  assert.equal(readList(g, 'normal', 3, 5), null);
  g.setIndex([2, 0]);
  assert.equal(drawnTriangles(g, 'triangles'), null);
  assert.equal(drawnTriangles(new Geometry(), 'points'), null);
  assert.equal(
    drawnTriangles(new Geometry().setAttribute('position', attr([], 3)), 'triangles'),
    null,
  );
});

test('point solids preserve source deformation per original point and material size', () => {
  const g = new Geometry().setAttribute('position', attr([1, 2, 3, 8, 9, 10], 3));
  g.morphAttributes.position = [attr([2, 3, 4, 9, 10, 11], 3)];
  const drawn = drawnTriangles(g, 'points', { size: 4 })!;
  assert.equal(drawn.indices.length, 48);
  assert.equal(drawn.positions.length, 144);
  assert.deepEqual([...drawn.sourceVertices!], [...Array(24).fill(0), ...Array(24).fill(1)]);
  const points = new Set<string>();
  for (let i = 0; i < drawn.positions.length; i += 3)
    points.add(Array.from(drawn.positions.slice(i, i + 3)).join(','));
  assert.deepEqual(
    points,
    new Set([
      '3,2,3',
      '-1,2,3',
      '1,4,3',
      '1,0,3',
      '1,2,5',
      '1,2,1',
      '10,9,10',
      '6,9,10',
      '8,11,10',
      '8,7,10',
      '8,9,12',
      '8,9,8',
    ]),
  );
  assert.ok([...drawn.deformation!.targets[0].positions].every((x) => x === 1));
  const single = new Geometry().setAttribute('position', attr([0, 0, 0], 3));
  assert.equal(Math.max(...drawnTriangles(single, 'points')!.positions), 0.5);
});

test('line modes keep unpaired tails out and trace skinned endpoint permutations', () => {
  assert.deepEqual(lineCorners([4, 2, 7, 9, 3], 'lineSegments'), [4, 2, 7, 9]);
  assert.deepEqual(lineCorners([4, 2], 'lineLoop'), [4, 2]);
  assert.deepEqual(lineCorners([4, 2, 7], 'lineLoop'), [4, 2, 2, 7, 7, 4]);
  assert.deepEqual(lineCorners([4], 'lineStrip'), []);
  const g = new Geometry().setAttribute('position', attr([0, 0, 0, 3, 4, 0], 3));
  g.morphAttributes.position = [attr([1, 1, 1, 4, 5, 1], 3)];
  const drawn = drawnTriangles(g, 'lineSegments', { dashed: true })!;
  assert.deepEqual([...drawn.sourceVertices!], [0, 0, 1, 1]);
  assert.deepEqual([...drawn.uvs!], [0, 0, 0, 0, 5, 0, 5, 0]);
  assert.deepEqual([...drawn.indices], [0, 1, 3, 0, 3, 2]);
  assert.deepEqual([...drawn.deformation!.targets[0].positions], Array(12).fill(1));
});
