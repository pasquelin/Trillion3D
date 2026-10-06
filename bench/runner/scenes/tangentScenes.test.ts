import test from 'node:test'
import assert from 'node:assert/strict'
import { TANGENT_BLEND_ALPHA, tangentSceneGltf } from './tangentScenes.ts'

/** The shape of the public scene: one normal-mapped primitive with authored tangents. */
const source = () => ({
  materials: [{ normalTexture: { index: 1 }, pbrMetallicRoughness: { baseColorTexture: {} } }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TANGENT: 2, TEXCOORD_0: 3 } }] }],
  accessors: [{ count: 5 }, { count: 5 }, { count: 5 }, { count: 5 }],
  buffers: [{ uri: 'scene.bin', byteLength: 100 }],
  bufferViews: [{ buffer: 0 }],
})

test('a blended scene blends the material and keeps its normal map and the authored tangents', () => {
  for (const unpaged of [false, true]) {
    const { gltf } = tangentSceneGltf(source(), true, unpaged)
    const [material] = gltf.materials
    const pbr = material.pbrMetallicRoughness as { baseColorFactor: number[] }
    assert.equal(material.alphaMode, 'BLEND')
    assert.deepEqual(pbr.baseColorFactor, [1, 1, 1, TANGENT_BLEND_ALPHA])
    assert.deepEqual(material.normalTexture, { index: 1 })
    assert.equal(gltf.meshes[0].primitives[0].attributes.TANGENT, 2)
  }
})

test('an opaque scene keeps the source material as it is', () => {
  for (const unpaged of [false, true]) {
    const { gltf } = tangentSceneGltf(source(), false, unpaged)
    assert.deepEqual(gltf.materials, source().materials)
    assert.equal(gltf.meshes[0].primitives[0].attributes.TANGENT, 2)
  }
})

test('only an unpaged scene carries a morph target, and it moves nothing', () => {
  const paged = tangentSceneGltf(source(), true, false)
  assert.equal(paged.zeroBytes, 0)
  assert.equal(paged.gltf.meshes[0].primitives[0].targets, undefined)
  const { gltf, zeroBytes } = tangentSceneGltf(source(), false, true)
  assert.equal(zeroBytes, 5 * 12)
  const [target] = gltf.meshes[0].primitives[0].targets as { POSITION: number }[]
  const morph = gltf.accessors[target.POSITION]
  assert.deepEqual([morph.count, morph.min, morph.max], [5, [0, 0, 0], [0, 0, 0]])
  assert.deepEqual(gltf.meshes[0].weights, [0])
  assert.equal(gltf.buffers.at(-1)!.byteLength, zeroBytes)
})
