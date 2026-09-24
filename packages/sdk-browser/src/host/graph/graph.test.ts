/**
 * The engine's own graph holds the reference's numbers: the same poses composed into the same
 * world matrices, the same aim, the same projection, the same element read out of a normalised or
 * interleaved attribute and the same bounds. Each rule is checked against the reference library,
 * which a test may name, on values away from the trivial ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GraphNode } from './node.ts';
import { GraphGroup, GraphInstancedMesh, GraphMesh } from './mesh.ts';
import { GraphCamera } from './camera.ts';
import { GraphAmbientLight, GraphLight, GraphLightProbe, GraphRectLight } from './light.ts';
import { GraphAttribute, GraphInterleavedAttribute, GraphInterleavedBuffer } from './attributes.ts';
import { GraphGeometry } from './geometry.ts';
import { GraphSurface } from './surface.ts';
import { GraphTexture } from './texture.ts';
import { hookHostNode } from '../scene/hooks.ts';

test('a posed chain resolves to the reference world matrices, aim and decomposition included', () => {
  const [a, b, c] = [new GraphGroup(), new GraphNode(), new GraphCamera({ fov: 47, aspect: 1.6 })];
  const [ta, tb, tc] = [
    new THREE.Group(),
    new THREE.Object3D(),
    new THREE.PerspectiveCamera(47, 1.6),
  ];
  a.add(b.add(c));
  ta.add(tb.add(tc));
  [a, b, c].forEach((node, k) => node.position.set(1.5 * k, -2.25, 0.125 + k));
  [ta, tb, tc].forEach((node, k) => node.position.set(1.5 * k, -2.25, 0.125 + k));
  const q = new THREE.Quaternion(0.1, 0.7, -0.2, 0.6).normalize();
  b.quaternion.set(q.x, q.y, q.z, q.w);
  tb.quaternion.copy(q);
  a.scale.set(1, 3, 0.5);
  ta.scale.set(1, 3, 0.5);
  c.lookAt({ x: 4, y: -1, z: 9 });
  tc.lookAt(4, -1, 9);
  a.updateMatrixWorld(true);
  ta.updateMatrixWorld(true);
  assert.deepEqual([...c.matrixWorld.elements], tc.matrixWorld.elements);
  assert.deepEqual([...c.projectionMatrix.elements], tc.projectionMatrix.elements);
  assert.deepEqual([c.rotation.x, c.rotation.y, c.rotation.z], tc.rotation.toArray().slice(0, 3));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(3, -1, 2),
    q,
    new THREE.Vector3(-2, 1.5, 0.25),
  );
  const [n, tn] = [new GraphNode(), new THREE.Object3D()];
  n.applyMatrix4({ elements: m.elements });
  tn.applyMatrix4(m);
  const numbers = (node: GraphNode | THREE.Object3D) =>
    [node.position, node.quaternion, node.scale].flatMap((v) => [v.x, v.y, v.z]);
  assert.deepEqual(numbers(n), numbers(tn));
  assert.equal(n.quaternion.w, tn.quaternion.w);
});

test('a rotation premultiplied by another turns as the reference product', () => {
  const [q, p] = [new GraphNode().quaternion, new GraphNode().quaternion];
  const tq = new THREE.Quaternion(0.1, 0.7, -0.2, 0.6).normalize();
  const tp = new THREE.Quaternion(-0.4, 0.3, 0.8, 0.2).normalize();
  q.copy(tq);
  p.copy(tp);
  q.premultiply(p);
  tq.premultiply(tp);
  assert.deepEqual([q.x, q.y, q.z, q.w], tq.toArray());
});

test('angles and quaternion follow each other, and a watch hears either face', () => {
  const node = new GraphNode(),
    reference = new THREE.Object3D();
  node.rotation.set(0.3, -1.1, 2.4);
  reference.rotation.set(0.3, -1.1, 2.4);
  const { x, y, z, w } = node.quaternion;
  assert.deepEqual([x, y, z, w], reference.quaternion.toArray());
  const revision = { revision: 0 };
  hookHostNode(node, revision);
  node.position.x = 4;
  node.rotation.y = 0.5;
  node.quaternion.set(0, 0, 0, 1);
  assert.equal(revision.revision, 3);
});

test('a normalised or interleaved element reads as the reference reads it', () => {
  const bytes = new Int16Array([32767, -32768, 12, 7, -5, 3000]);
  const [own, reference] = [
    new GraphAttribute(bytes, 3, true),
    new THREE.BufferAttribute(bytes, 3, true),
  ];
  const data = new Float32Array([1, 2, 3, 9, 4, 5, 6, 9]);
  const view = new GraphInterleavedAttribute(new GraphInterleavedBuffer(data, 4), 3, 0);
  const tview = new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(data, 4), 3, 0);
  for (let i = 0; i < 2; i++)
    for (const get of ['getX', 'getY', 'getZ'] as const) {
      assert.equal(own[get](i), reference[get](i));
      assert.equal(view[get](i), tview[get](i));
    }
  assert.equal(view.count, tview.count);
});

test('a geometry bounds itself as the reference does, morph targets included', () => {
  const positions = new Float32Array([0, 0, 0, 1, 2, 3, -4, 0.5, 2]);
  const morph = new Float32Array([0.5, -1, 0, 0, 0, 2, 1, 1, 1]);
  const geometry = new GraphGeometry().setAttribute('position', new GraphAttribute(positions, 3));
  geometry.morphAttributes.position = [new GraphAttribute(morph, 3)];
  geometry.morphTargetsRelative = true;
  const reference = new THREE.BufferGeometry();
  reference.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  reference.morphAttributes.position = [new THREE.BufferAttribute(morph, 3)];
  reference.morphTargetsRelative = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  reference.computeBoundingBox();
  reference.computeBoundingSphere();
  assert.deepEqual(
    [...geometry.boundingBox!.min.toArray(), ...geometry.boundingBox!.max.toArray()],
    [...reference.boundingBox!.min.toArray(), ...reference.boundingBox!.max.toArray()],
  );
  assert.deepEqual(
    [...geometry.boundingSphere!.center.toArray(), geometry.boundingSphere!.radius],
    [...reference.boundingSphere!.center.toArray(), reference.boundingSphere!.radius],
  );
});

test('a texture transform, a surface family and a copied light hold the reference values', () => {
  const texture = new GraphTexture(null),
    reference = new THREE.Texture();
  for (const t of [texture, reference]) {
    t.offset.set(0.25, -0.5);
    t.repeat.set(2, 3);
    t.center.set(0.5, 0.5);
    t.rotation = 0.7;
    t.updateMatrix();
  }
  assert.deepEqual([...texture.matrix.elements], reference.matrix.elements);
  const surface = new GraphSurface('physical'),
    physical = new THREE.MeshPhysicalMaterial() as unknown as Record<string, unknown>;
  for (const key of ['ior', 'blending', 'depthFunc', 'side', 'normalMapType', 'alphaTest'])
    assert.equal(surface[key], physical[key], key);
  const light = new GraphLight('spot'),
    spot = new THREE.SpotLight();
  const copy = light.clone();
  assert.deepEqual(
    [copy.angle, copy.penumbra, copy.decay, copy.distance, copy.position.x, copy.position.y],
    [spot.angle, spot.penumbra, spot.decay, spot.distance, spot.position.x, spot.position.y],
  );
  assert.notEqual(copy.target, light.target, 'a copied light aims at a copy of the target');
  const mesh = new GraphMesh(new GraphGeometry(), surface);
  assert.equal(mesh.clone().material, surface, 'a copied mesh shares its surface');
});

test('a copied geometry owns its buffers, and a triangle list spells every corner, as the reference', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    order = new Uint16Array([0, 1, 2, 2, 1, 3]),
    shades = new Uint8Array([0, 64, 128, 255]);
  const geometry = new GraphGeometry().setIndex(new GraphAttribute(order, 1));
  geometry.setAttribute('position', new GraphAttribute(positions, 3));
  geometry.setAttribute('shade', new GraphAttribute(shades, 1, true));
  const reference = new THREE.BufferGeometry().setIndex(new THREE.BufferAttribute(order, 1));
  reference.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  reference.setAttribute('shade', new THREE.BufferAttribute(shades, 1, true));
  const copy = geometry.clone();
  assert.notEqual(copy.attributes.position.array, positions, 'the copy owns its positions');
  assert.deepEqual([...copy.index!.array], [...order]);
  const flat = geometry.toNonIndexed(),
    expected = reference.toNonIndexed();
  assert.equal(flat.index, null);
  for (const name of ['position', 'shade']) {
    assert.deepEqual([...flat.attributes[name].array], [...expected.attributes[name].array], name);
    assert.equal(flat.attributes[name].normalized, expected.attributes[name].normalized, name);
    assert.equal(
      flat.attributes[name].array.constructor,
      expected.attributes[name].array.constructor,
    );
  }
});

test('the ambient, rectangle and probe lights copy themselves whole', () => {
  const ambient = new GraphAmbientLight(undefined, Math.PI).clone();
  assert.equal(ambient.kind, 'ambient');
  assert.equal(ambient.intensity, Math.PI);
  const rect = Object.assign(new GraphRectLight(), { width: 2, height: 3, distance: 9 }).clone();
  assert.deepEqual([rect.kind, rect.width, rect.height, rect.distance], ['rect', 2, 3, 9]);
  const probe = new GraphLightProbe();
  probe.sh.fromArray(Array.from({ length: 27 }, (_, i) => i));
  const copy = probe.clone();
  assert.deepEqual([copy.sh.coefficients[8].x, copy.sh.coefficients[8].z], [24, 26]);
  assert.notEqual(copy.sh.coefficients[8], probe.sh.coefficients[8]);
});

test('an instanced mesh holds one matrix per placement and gives them back once', () => {
  const mesh = new GraphInstancedMesh(new GraphGeometry(), new GraphSurface('standard'), 3);
  assert.equal(mesh.instanceMatrix.array.length, 48);
  assert.equal(mesh.count, 3);
  let released = 0;
  mesh.released.add(() => released++);
  mesh.dispose();
  mesh.dispose();
  assert.equal(released, 1);
});
