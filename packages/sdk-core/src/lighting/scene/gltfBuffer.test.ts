import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingGltfBuffer } from './gltfBuffer.ts';
import { readLightingGltf } from '../../../../../tests/fixtures/lightingSceneGltfTestHelpers.ts';

const normals = [0, 0, 1, 0, 1, 0, 1, 0, 0],
  uv = [0.25, 0.5, 0.75, 1, 0, 0];

/** Two triangles: the first with an odd index count, so its index view needs padding. */
function twoMeshes() {
  const buffer = createLightingGltfBuffer();
  buffer.materials.push({ name: 'paint' }, { name: 'stone' });
  buffer.mesh('panel', [1, -2, 3, 4, 5, -6, -7, 8, 9], normals, uv, [2, 0, 1], 0, { id: 'panel' });
  buffer.mesh('other', [-1, -2, -3, 4, 5, 6, 7, 8, 9], normals, uv, [0, 1, 2], 1, {});
  const { gltf, binary } = buffer.finish();
  return { gltf: gltf as any, binary, ...readLightingGltf(gltf, binary) };
}

test('each mesh reads back its positions, normals, coordinates and indices', () => {
  const { meshes, read } = twoMeshes();
  const [panel, other] = meshes.map((mesh) => mesh.primitives[0]);
  assert.deepEqual(read(panel.attributes.POSITION), [1, -2, 3, 4, 5, -6, -7, 8, 9]);
  assert.deepEqual(read(panel.attributes.NORMAL), normals);
  assert.deepEqual(read(panel.attributes.TEXCOORD_0), uv);
  assert.deepEqual(read(panel.indices), [2, 0, 1]);
  assert.deepEqual(read(other.attributes.POSITION), [-1, -2, -3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(read(other.indices), [0, 1, 2]);
});

test('accessors count elements and bound each component of the stored values', () => {
  const { gltf, meshes } = twoMeshes();
  const accessor = (index: number) => gltf.accessors[index];
  const panel = meshes[0].primitives[0];
  const position = accessor(panel.attributes.POSITION);
  assert.deepEqual([position.type, position.count], ['VEC3', 3]);
  assert.deepEqual(
    [position.min, position.max],
    [
      [-7, -2, -6],
      [4, 8, 9],
    ],
  );
  const texture = accessor(panel.attributes.TEXCOORD_0);
  assert.deepEqual([texture.type, texture.count], ['VEC2', 3]);
  assert.deepEqual(
    [texture.min, texture.max],
    [
      [0, 0],
      [0.75, 1],
    ],
  );
  const indices = accessor(panel.indices);
  assert.deepEqual(
    [indices.type, indices.count, indices.min, indices.max],
    ['SCALAR', 3, [0], [2]],
  );
  for (const item of gltf.accessors) assert.equal(item.byteOffset, 0);
});

test('views follow each other in one buffer, aligned to four bytes with no more padding', () => {
  const { gltf, binary, views } = twoMeshes();
  let end = 0;
  for (const view of views) {
    assert.equal(view.byteOffset % 4, 0);
    assert.ok(view.byteOffset >= end && view.byteOffset - end < 4, `${view.byteOffset}`);
    end = view.byteOffset + view.byteLength;
  }
  assert.ok(binary.byteLength >= end && binary.byteLength - end < 4);
  assert.deepEqual(gltf.buffers, [{ uri: 'scene.bin', byteLength: binary.byteLength }]);
  assert.ok(gltf.bufferViews.every((view: { buffer: number }) => view.buffer === 0));
});

test('index views and vertex views name their buffer targets apart', () => {
  const { gltf, meshes } = twoMeshes();
  const primitive = meshes[0].primitives[0];
  const target = (accessor: number) => gltf.bufferViews[gltf.accessors[accessor].bufferView].target;
  const vertices = Object.values(primitive.attributes).map(target);
  assert.equal(new Set(vertices).size, 1);
  assert.notEqual(target(primitive.indices), vertices[0]);
  assert.equal(target(meshes[1].primitives[0].indices), target(primitive.indices));
});

test('the scene lists every node, each naming its mesh, material and metadata', () => {
  const { gltf, meshes, nodes } = twoMeshes();
  assert.equal(gltf.asset.version, '2.0');
  assert.equal(gltf.scene, 0);
  assert.deepEqual(gltf.scenes, [{ nodes: [0, 1] }]);
  assert.deepEqual(gltf.materials, [{ name: 'paint' }, { name: 'stone' }]);
  assert.deepEqual(nodes, [
    { name: 'panel', mesh: 0, extras: { id: 'panel' } },
    { name: 'other', mesh: 1, extras: {} },
  ]);
  assert.deepEqual(
    meshes.map((mesh) => [mesh.name, mesh.primitives[0].material]),
    [
      ['panel', 0],
      ['other', 1],
    ],
  );
  assert.deepEqual(gltf.meshes[0].extras, { id: 'panel' });
  assert.ok(gltf.meshes.every((mesh: any) => mesh.primitives[0].mode === 4));
});
