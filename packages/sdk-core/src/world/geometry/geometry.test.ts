import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry, withRecipe } from './geometry.ts';
import { drawnTriangles } from './drawn.ts';
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from '../buffer/attribute.ts';

const box = (g: Geometry) => [...g.boundingBox!.min.toArray(), ...g.boundingBox!.max.toArray()];

test('a copied geometry keeps every value it held: lists, morphs, groups, range, data, bounds', () => {
  const g = new Geometry()
    .setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]), 3))
    .setIndex([0, 1, 2]);
  g.addGroup(0, 3, 1);
  g.name = 'tri';
  g.morphAttributes.position = [new BufferAttribute(new Float32Array(9).fill(1), 3)];
  g.morphTargetsRelative = true;
  g.drawRange = { start: 0, count: 3 };
  g.userData = { tag: { deep: 1 } };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  withRecipe(g, 'triangle', [1]);
  const copy = g.clone();
  assert.equal(copy.name, 'tri');
  assert.deepEqual(
    Array.from(copy.attributes.position.array),
    Array.from(g.attributes.position.array),
  );
  assert.notEqual(copy.attributes.position.array, g.attributes.position.array, 'owns its buffer');
  assert.deepEqual(Array.from(copy.index!.array), [0, 1, 2]);
  assert.deepEqual(copy.groups, [{ start: 0, count: 3, materialIndex: 1 }]);
  assert.deepEqual(Array.from(copy.morphAttributes.position[0].array), Array(9).fill(1));
  assert.equal(copy.morphTargetsRelative, true);
  assert.deepEqual(copy.drawRange, { start: 0, count: 3 });
  assert.deepEqual(copy.userData, { tag: { deep: 1 } });
  assert.notEqual(copy.userData.tag, g.userData.tag);
  assert.deepEqual(box(copy), box(g));
  assert.equal(copy.boundingSphere!.radius, g.boundingSphere!.radius);
  assert.deepEqual(copy.recipe, { type: 'triangle', args: [1] });
});

test('a normalised or interleaved position is bounded at the value it stands for', () => {
  const normalised = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Int16Array([-32767, 0, 0, 32767, 16384, 0]), 3, true),
  );
  normalised.computeBoundingBox();
  assert.deepEqual(box(normalised), [-1, 0, 0, 1, 16384 / 32767, 0]);
  // Two vertices of six numbers: position then a colour the box must not read.
  const pack = new InterleavedBuffer(new Float32Array([1, 2, 3, 9, 9, 9, -1, -2, -3, 9, 9, 9]), 6);
  const interleaved = new Geometry().setAttribute(
    'position',
    new InterleavedBufferAttribute(pack, 3, 0),
  );
  interleaved.computeBoundingBox();
  assert.deepEqual(box(interleaved), [-1, -2, -3, 1, 2, 3]);
});

test('a normalised position is drawn at the value it stands for', () => {
  const g = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true),
  );
  const drawn = drawnTriangles(g, 'triangles')!;
  assert.deepEqual(Array.from(drawn.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('a colour change keeps the bounds, a position change forgets them', () => {
  const g = new Geometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  g.computeBoundingBox();
  g.setAttribute('color', new BufferAttribute(new Float32Array(9), 3));
  assert.ok(g.boundingBox, 'a colour does not move a vertex');
  g.attributes.position.needsUpdate = true;
  assert.equal(g.boundingBox, null);
});

test('a given-back geometry runs each release hook once', () => {
  const g = new Geometry();
  let runs = 0;
  g.released.add(() => runs++);
  g.dispose();
  g.dispose();
  assert.equal(runs, 1);
});
