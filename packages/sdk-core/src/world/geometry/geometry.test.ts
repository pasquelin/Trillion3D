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
  assert.equal(owned('host').setIndex([0]).toNonIndexed()._owner, 'host', 'keeps its owner');
  assert.equal(owned('host').clone()._owner, 'host', 'a copy keeps its owner');
});

// #945: a position is read at the value it stands for by every owner and on every path — drawn,
// bounded, edged, moved, given normals: a normalised integer scaled back, a two-wide one at z = 0.
test('a normalised position is bounded and drawn at its value, an interleaved one through its stride', () => {
  const stored = new Int16Array([0, 0, 0, 32767, 0, 0, 0, 16384, 0]),
    half = 16384 / 32767;
  const normalised = new Geometry().setAttribute('position', new BufferAttribute(stored, 3, true));
  normalised.computeBoundingBox();
  normalised.computeBoundingSphere();
  assert.deepEqual(box(normalised), [0, 0, 0, 1, half, 0]);
  assert.equal(normalised.boundingSphere!.radius, Math.hypot(1 / 2, half / 2));
  const drawn = drawnTriangles(normalised, 'triangles')!.positions;
  assert.deepEqual(Array.from(drawn), [0, 0, 0, 1, 0, 0, 0, Math.fround(half), 0]);
  // Two vertices of six numbers: position then a colour the box must not read.
  const pack = new InterleavedBuffer(new Float32Array([1, 2, 3, 9, 9, 9, -1, -2, -3, 9, 9, 9]), 6);
  const interleaved = new Geometry().setAttribute(
    'position',
    new InterleavedBufferAttribute(pack, 3, 0),
  );
  interleaved.computeBoundingBox();
  assert.deepEqual(box(interleaved), [-1, -2, -3, 1, 2, 3]);
});

test('a two-wide position lies at z = 0, a moved normalised one moves at its value', () => {
  const flat = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2),
  );
  const drawn = drawnTriangles(flat, 'triangles')!;
  assert.deepEqual(Array.from(drawn.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  flat.computeBoundingBox();
  assert.deepEqual(box(flat), [0, 0, 0, 1, 1, 0]);
  const normals = flat.computeVertexNormals().attributes.normal.array;
  assert.deepEqual(Array.from(normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  flat.translate(1, 0, 5);
  assert.deepEqual(Array.from(flat.attributes.position.array), [1, 0, 2, 0, 1, 1]);
  const moved = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Int16Array([0, 2, 3]), 3, true),
  );
  moved.translate(0.5, 0, 0);
  assert.deepEqual(Array.from(moved.attributes.position.array), [16384, 2, 3]);
});

// #457: a normal, uv or colour list a world geometry owns has always been drawn and turned as its
// stored numbers, a normalised integer unscaled; a host geometry's (a quantized glTF's) at its value.
const triangle = () => new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3);
const normalised = (array: Int8Array | Uint8Array | Int16Array | Uint16Array, itemSize: number) =>
  new BufferAttribute(array, itemSize, true);
type Owner = Geometry['_owner'];
/** An empty geometry built by `owner`, as its maker marks it. */
const owned = (owner: Owner) => Object.assign(new Geometry(), { _owner: owner });

test('a world geometry draws the normalised colour, normal and uv it owns as stored, a host one at their value', () => {
  const shaded = (owner: Owner) =>
    drawnTriangles(
      owned(owner)
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

test('a normalised position gives its edges at its value, whoever owns it', () => {
  const lines = (owner: Owner, of: typeof wireframe) =>
    Array.from(
      of(
        owned(owner).setAttribute(
          'position',
          normalised(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3),
        ),
      ).attributes.position.array,
    );
  const valued = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0];
  for (const owner of ['world', 'host'] as const)
    for (const read of [wireframe, edges]) assert.deepEqual(lines(owner, read), valued);
});

test('a world geometry turns a normalised normal it owns as stored, a host one and a view at their value', () => {
  const turned = (owner: Owner) => {
    const g = owned(owner)
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

test('a relative morph target is bounded vertex by vertex, never box on box', () => {
  const geometry = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 10, 0, 0]), 3),
  );
  // Vertex 0 moves right by 5, vertex 1 stays: no vertex lands past x = 10, where the base box
  // plus the box of the deltas would reach 15.
  geometry.morphAttributes.position = [
    new BufferAttribute(new Float32Array([5, 0, 0, 0, 0, 0]), 3),
  ];
  geometry.morphTargetsRelative = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  assert.deepEqual(box(geometry), [0, 0, 0, 10, 0, 0]);
  assert.equal(geometry.boundingSphere!.radius, 5);
});

const sheet = () =>
  new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([1, 2, 3, 7, 2, 3, 1, 5, 3]), 3),
  );

test('geometry changes notify holders, invalidate position bounds and preserve unrelated bounds', () => {
  const geometry = sheet();
  let writes = 0;
  geometry._listeners.add(() => writes++);
  const box = geometry.computeBoundingBox(),
    sphere = geometry.computeBoundingSphere();
  geometry.recipe = { type: 'triangle', args: [] };
  const initial = geometry.version;
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  assert.equal(geometry.version, initial + 1);
  assert.equal(writes, 1);
  assert.equal(geometry.boundingBox, box);
  assert.equal(geometry.boundingSphere, sphere);
  assert.equal(geometry.recipe, null);
  assert.equal(geometry.hasAttribute('uv'), true);
  geometry.getAttribute('position')!.needsUpdate = true;
  assert.equal(geometry.boundingBox, null);
  assert.equal(geometry.boundingSphere, null);
  assert.equal(writes, 2);
  geometry.deleteAttribute('uv');
  assert.equal(geometry.hasAttribute('uv'), false);
  assert.equal(geometry.getAttribute('uv'), undefined);
  geometry.addGroup(0, 3, 2);
  geometry.addGroup(3, 6);
  assert.deepEqual(geometry.groups, [
    { start: 0, count: 3, materialIndex: 2 },
    { start: 3, count: 6, materialIndex: 0 },
  ]);
  geometry.clearGroups();
  assert.deepEqual(geometry.groups, []);
  geometry.setIndex([2, 1, 0]);
  assert.deepEqual([...geometry.getIndex()!.array], [2, 1, 0]);
  geometry.setIndex(null);
  assert.equal(geometry.getIndex(), null);
});

test('geometry transforms preserve winding normals and independently known position extents', () => {
  const geometry = sheet().computeVertexNormals();
  assert.deepEqual([...geometry.getAttribute('normal')!.array], [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  geometry.scale(2, 3, 4).translate(-2, -6, -12);
  assert.deepEqual([...geometry.getAttribute('position')!.array], [0, 0, 0, 12, 0, 0, 0, 9, 0]);
  assert.deepEqual([...geometry.getAttribute('normal')!.array], [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const box = geometry.computeBoundingBox();
  assert.deepEqual(box.min.toArray(), [0, 0, 0]);
  assert.deepEqual(box.max.toArray(), [12, 9, 0]);
  const sphere = geometry.computeBoundingSphere();
  assert.deepEqual(sphere.center.toArray(), [6, 4.5, 0]);
  assert.equal(sphere.radius, 7.5);
  geometry.center();
  assert.deepEqual(geometry.computeBoundingBox().getCenter().toArray(), [0, 0, 0]);
  assert.equal(new Geometry().computeVertexNormals().hasAttribute('normal'), false);
});

test('geometry clones preserve independent attributes, morph targets and metadata', () => {
  const geometry = sheet().setIndex([2, 1, 0]);
  geometry.name = 'panel';
  geometry.morphAttributes.position = [
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  ];
  geometry.morphTargetsRelative = true;
  geometry.userData = { nested: { id: 7 } };
  geometry.drawRange = { start: 1, count: 2 };
  geometry.addGroup(0, 3, 4);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.recipe = { type: 'panel', args: [6, 3] };
  const copy = geometry.clone();
  assert.equal(copy.name, 'panel');
  assert.deepEqual(copy.drawRange, { start: 1, count: 2 });
  assert.deepEqual(copy.groups, geometry.groups);
  assert.equal(copy.morphTargetsRelative, true);
  assert.deepEqual(copy.userData, geometry.userData);
  assert.notEqual(copy.userData, geometry.userData);
  assert.notEqual(copy.groups[0], geometry.groups[0]);
  assert.notEqual(copy.index!.array, geometry.index!.array);
  assert.notEqual(copy.boundingBox, geometry.boundingBox);
  assert.notEqual(copy.boundingSphere, geometry.boundingSphere);
  assert.deepEqual(copy.recipe, geometry.recipe);
  assert.notEqual(copy.recipe!.args, geometry.recipe!.args);
  copy.getAttribute('position')!.setX(0, 99);
  assert.equal(geometry.getAttribute('position')!.getX(0), 1);
  copy.morphAttributes.position[0].setZ(0, 9);
  assert.equal(geometry.morphAttributes.position[0].getZ(0), 1);
  const unindexed = geometry.toNonIndexed();
  assert.equal(unindexed.index, null);
  assert.deepEqual([...unindexed.getAttribute('position')!.array], [1, 5, 3, 7, 2, 3, 1, 2, 3]);
  assert.deepEqual(unindexed.groups, []);
  const plain = sheet(),
    again = plain.toNonIndexed();
  assert.notEqual(plain.getAttribute('position')!.array, again.getAttribute('position')!.array);
  let releases = 0;
  geometry.released.add(() => releases++);
  geometry.dispose();
  geometry.dispose();
  assert.equal(releases, 1);
  assert.equal(geometry._listeners.size, 0);
});

test('editing a triangle index notifies holders and preserves position-only bounds', () => {
  const geometry = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3),
  );
  const box = geometry.computeBoundingBox();
  const sphere = geometry.computeBoundingSphere();
  geometry.setIndex([0, 1, 2]);
  assert.equal(geometry.boundingBox, box);
  assert.equal(geometry.boundingSphere, sphere);
  let notifications = 0;
  geometry._listeners.add(() => notifications++);
  const version = geometry.version;
  geometry.recipe = { type: 'triangle', args: [] };
  geometry.index!.array[0] = 2;
  geometry.index!.needsUpdate = true;
  assert.equal(geometry.version, version + 1);
  assert.equal(notifications, 1);
  assert.equal(geometry.recipe, null);
  assert.equal(geometry.boundingBox, box);
  assert.equal(geometry.boundingSphere, sphere);
});
