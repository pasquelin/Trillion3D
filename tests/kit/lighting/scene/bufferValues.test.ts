import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingGltfBuffer } from './gltfBuffer.ts';

test('glTF accessors decode the original mesh values, indices and metadata from aligned binary views', () => {
  const buffer = createLightingGltfBuffer();
  const positions = [1, -2, 3, 4, 5, -6, -7, 8, 9];
  const normals = [0, 0, 1, 0, 1, 0, 1, 0, 0],
    uv = [0.25, 0.5, 0.75, 1, 0, 0];
  const extras = { id: 'panel' };
  buffer.materials.push({ name: 'paint' });
  buffer.mesh('panel', positions, normals, uv, [2, 0, 1], 0, extras);
  buffer.mesh('other', [-1, -2, -3, 4, 5, 6, 7, 8, 9], normals, uv, [0, 1, 2], 0, {});
  const { gltf, binary } = buffer.finish();
  const data = gltf as any;
  assert.deepEqual(data.scenes, [{ nodes: [0, 1] }]);
  assert.equal(data.scene, 0);
  assert.deepEqual(data.nodes[0], { name: 'panel', mesh: 0, extras });
  assert.equal(data.nodes[1].mesh, 1);
  assert.equal(data.meshes[0].name, 'panel');
  assert.deepEqual(data.materials, [{ name: 'paint' }]);
  assert.equal(data.buffers[0].byteLength, binary.length);
  const read = (index: number) => {
    const accessor = data.accessors[index],
      view = data.bufferViews[accessor.bufferView];
    assert.equal(view.buffer, 0);
    assert.equal(view.byteOffset % 4, 0);
    assert.equal(accessor.byteOffset, 0);
    const bytes = new DataView(binary.buffer, binary.byteOffset + view.byteOffset, view.byteLength);
    const words = accessor.componentType === 5123 ? 2 : 4;
    const values = Array.from({ length: view.byteLength / words }, (_, i) =>
      words === 2 ? bytes.getUint16(i * 2, true) : bytes.getFloat32(i * 4, true),
    );
    assert.equal(view.target, words === 2 ? 34963 : 34962);
    return { accessor, values };
  };
  const primitive = data.meshes[0].primitives[0];
  assert.equal(primitive.mode, 4);
  assert.equal(primitive.material, 0);
  const position = read(primitive.attributes.POSITION);
  assert.deepEqual(position.values, positions);
  assert.equal(position.accessor.type, 'VEC3');
  assert.equal(position.accessor.count, 3);
  assert.deepEqual(position.accessor.min, [-7, -2, -6]);
  assert.deepEqual(position.accessor.max, [4, 8, 9]);
  assert.deepEqual(read(primitive.attributes.NORMAL).values, normals);
  const texture = read(primitive.attributes.TEXCOORD_0);
  assert.deepEqual(texture.values, uv);
  assert.equal(texture.accessor.type, 'VEC2');
  assert.deepEqual(texture.accessor.min, [0, 0]);
  assert.deepEqual(texture.accessor.max, [0.75, 1]);
  const indices = read(primitive.indices);
  assert.deepEqual(indices.values, [2, 0, 1]);
  assert.equal(indices.accessor.type, 'SCALAR');
  assert.equal(indices.accessor.count, 3);
  assert.deepEqual(indices.accessor.min, [0]);
  assert.deepEqual(indices.accessor.max, [2]);
  assert.deepEqual(read(data.meshes[1].primitives[0].indices).values, [0, 1, 2]);
  assert.equal(data.asset.version, '2.0');
  assert.ok(data.asset.generator.length > 0);
});
