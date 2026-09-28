import test from 'node:test';
import assert from 'node:assert/strict';
import { TANGENT_BLEND_ALPHA, tangentBlendGltf } from './tangentBlend.ts';

/** The shape of the public scene: one normal-mapped primitive with authored tangents. */
const source = () => ({
  materials: [{ normalTexture: { index: 1 }, pbrMetallicRoughness: { baseColorTexture: {} } }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TANGENT: 2, TEXCOORD_0: 3 } }] }],
  accessors: [{ count: 5 }, { count: 5 }, { count: 5 }, { count: 5 }],
  buffers: [{ uri: 'scene.bin', byteLength: 100 }],
  bufferViews: [{ buffer: 0 }],
});

test('both scenes blend the material and keep its normal map and the authored tangents', () => {
  for (const unpaged of [false, true]) {
    const { gltf } = tangentBlendGltf(source(), unpaged);
    const [material] = gltf.materials as {
      alphaMode: string;
      normalTexture: unknown;
      pbrMetallicRoughness: { baseColorFactor: number[] };
    }[];
    assert.equal(material.alphaMode, 'BLEND');
    assert.deepEqual(material.pbrMetallicRoughness.baseColorFactor, [1, 1, 1, TANGENT_BLEND_ALPHA]);
    assert.deepEqual(material.normalTexture, { index: 1 });
    assert.equal(gltf.meshes[0].primitives[0].attributes.TANGENT, 2);
  }
});

test('only the unpaged scene carries a morph target, and it moves nothing', () => {
  const paged = tangentBlendGltf(source(), false);
  assert.equal(paged.zeroBytes, 0);
  assert.equal(paged.gltf.meshes[0].primitives[0].targets, undefined);
  const { gltf, zeroBytes } = tangentBlendGltf(source(), true);
  assert.equal(zeroBytes, 5 * 12);
  const [target] = gltf.meshes[0].primitives[0].targets as { POSITION: number }[];
  const morph = gltf.accessors[target.POSITION];
  assert.deepEqual([morph.count, morph.min, morph.max], [5, [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(gltf.meshes[0].weights, [0]);
  assert.equal(gltf.buffers.at(-1)!.byteLength, zeroBytes);
});
