import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from './geometry.ts';
import { withRecipe } from './builder.ts';
import { drawnTriangles } from './drawn.ts';
import { edges, wireframe } from './lines.ts';
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
  assert.equal(new Geometry('host').toNonIndexed().owner, 'host', 'a copy keeps its owner');
});

test('a normalised position is bounded and drawn as its stored numbers, an interleaved one through its stride', () => {
  const stored = new Int16Array([0, 0, 0, 32767, 0, 0, 0, 16384, 0]);
  const normalised = new Geometry().setAttribute('position', new BufferAttribute(stored, 3, true));
  normalised.computeBoundingBox();
  normalised.computeBoundingSphere();
  assert.deepEqual(box(normalised), [0, 0, 0, 32767, 16384, 0]);
  assert.equal(normalised.boundingSphere!.radius, Math.hypot(32767 / 2, 16384 / 2));
  assert.deepEqual(Array.from(drawnTriangles(normalised, 'triangles')!.positions), [...stored]);
  // Two vertices of six numbers: position then a colour the box must not read.
  const pack = new InterleavedBuffer(new Float32Array([1, 2, 3, 9, 9, 9, -1, -2, -3, 9, 9, 9]), 6);
  const interleaved = new Geometry().setAttribute(
    'position',
    new InterleavedBufferAttribute(pack, 3, 0),
  );
  interleaved.computeBoundingBox();
  assert.deepEqual(box(interleaved), [-1, -2, -3, 1, 2, 3]);
});

test('a two-wide position is drawn with z = 1, a moved one as its stored numbers', () => {
  const flat = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2),
  );
  const drawn = drawnTriangles(flat, 'triangles')!;
  assert.deepEqual(Array.from(drawn.positions), [0, 0, 1, 1, 0, 1, 0, 1, 1]);
  const moved = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Int16Array([1, 2, 3]), 3, true),
  );
  moved.translate(1, 0, 0);
  assert.deepEqual(Array.from(moved.attributes.position.array), [2, 2, 3]);
});

// #457: a list a world geometry owns has always been drawn, edged and turned as its stored
// numbers, a normalised integer unscaled; a host geometry's (a quantized glTF's) at its value.
const triangle = () => new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3);
const normalised = (array: Int8Array | Uint8Array | Int16Array | Uint16Array, itemSize: number) =>
  new BufferAttribute(array, itemSize, true);

test('a world geometry draws the normalised colour, normal and uv it owns as stored, a host one at their value', () => {
  const shaded = (owner: 'world' | 'host') =>
    drawnTriangles(
      new Geometry(owner)
        .setAttribute('position', triangle())
        .setAttribute('normal', normalised(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, -128]), 3))
        .setAttribute('uv', normalised(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2))
        .setAttribute('color', normalised(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]), 3)),
      'triangles',
    )!;
  const world = shaded('world'),
    host = shaded('host');
  assert.deepEqual(Array.from(world.normals), [0, 0, 127, 0, 0, 127, 0, 0, -128]);
  assert.deepEqual(Array.from(world.uvs!), [0, 0, 65535, 0, 0, 65535]);
  assert.deepEqual(Array.from(world.colors!), [255, 0, 0, 1, 0, 255, 0, 1, 0, 0, 255, 1]);
  assert.deepEqual(Array.from(host.normals), [0, 0, 1, 0, 0, 1, 0, 0, -1]);
  assert.deepEqual(Array.from(host.uvs!), [0, 0, 1, 0, 0, 1]);
  assert.deepEqual(Array.from(host.colors!), [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]);
});

test('a normalised position gives its edges as stored in a world geometry, at its value in a host one', () => {
  const lines = (owner: 'world' | 'host', of: typeof wireframe) =>
    Array.from(
      of(
        new Geometry(owner).setAttribute(
          'position',
          normalised(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3),
        ),
      ).attributes.position.array,
    );
  const [o, s] = [0, 32767];
  const world = [o, o, o, s, o, o, s, o, o, o, s, o, o, s, o, o, o, o];
  assert.deepEqual(lines('world', wireframe), world);
  assert.deepEqual(lines('world', edges), world);
  const host = world.map((n) => n / s);
  assert.deepEqual(lines('host', wireframe), host);
  assert.deepEqual(lines('host', edges), host);
});

test('a world geometry turns a normalised normal it owns as stored, a host one and a view at their value', () => {
  const turned = (owner: 'world' | 'host') => {
    const g = new Geometry(owner)
      .setAttribute('position', triangle())
      .setAttribute('normal', normalised(new Int8Array([127, 0, 0, 0, 0, 127, 0, 0, 127]), 3));
    return Array.from(g.rotateZ(Math.PI / 2).attributes.normal.array);
  };
  // (127, 0, 0) turned is the unit (0, 1, 0): written as it is into a world list, normalised
  // into a host one.
  assert.deepEqual(turned('world'), [0, 1, 0, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual(turned('host'), [0, 127, 0, 0, 0, 127, 0, 0, 127]);
  // A view of an interleaved buffer is turned at the value it stands for, written normalised.
  const pack = new InterleavedBuffer(new Int8Array([127, 0, 0, 0, 0, 127, 0, 0, 127]), 3);
  new Geometry()
    .setAttribute('position', triangle())
    .setAttribute('normal', new InterleavedBufferAttribute(pack, 3, 0, true))
    .rotateZ(Math.PI / 2);
  assert.deepEqual(Array.from(pack.array), [0, 127, 0, 0, 0, 127, 0, 0, 127]);
});

test('a sphere reaches the farthest vertex from the centre of the box', () => {
  const g = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 1, 0, 2, 1, 0, 1, 0, 0, 1, 2, 0]), 3),
  );
  g.computeBoundingSphere();
  assert.deepEqual(g.boundingSphere!.center.toArray(), [1, 1, 0]);
  assert.equal(g.boundingSphere!.radius, 1, "not the box's corner, √2");
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
