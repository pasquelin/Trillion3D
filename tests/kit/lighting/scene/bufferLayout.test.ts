import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingGltfBuffer } from './gltfBuffer.ts';

test('glTF triangle packing has no unused accessors and stores integer indices with only alignment padding', () => {
  const buffer = createLightingGltfBuffer();
  buffer.mesh(
    'triangle',
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 0, 1, 0, 0, 1],
    [0, 1, 2],
    0,
    {},
  );
  const { gltf, binary } = buffer.finish();
  const data = gltf as any;
  assert.equal(binary.length, 104);
  assert.equal(data.accessors.length, 4);
  assert.deepEqual(
    data.bufferViews.map((view: any) => view.byteOffset),
    [0, 36, 72, 96],
  );
  const index = data.accessors[data.meshes[0].primitives[0].indices];
  assert.equal(index.componentType, 5123);
  assert.equal(data.bufferViews[index.bufferView].target, 34963);
  assert.deepEqual(index.min, [0]);
  assert.deepEqual(index.max, [2]);
});
