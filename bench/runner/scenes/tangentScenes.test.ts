import test from 'node:test'
import assert from 'node:assert/strict'
import { TANGENT_BLEND_ALPHA, TANGENT_TRANSMISSION, tangentSceneGltf } from './tangentScenes.ts'

/** The shape of the public scene: one normal-mapped primitive with authored tangents. */
const source = () => ({
  materials: [{ normalTexture: { index: 1 }, pbrMetallicRoughness: { baseColorTexture: {} } }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TANGENT: 2, TEXCOORD_0: 3 } }] }],
})

const PATHS = ['paged', 'unpaged', 'frame'] as const

test('a blended scene blends the material and keeps its normal map', () => {
  for (const path of PATHS) {
    const gltf = tangentSceneGltf(source(), true, path)
    const [material] = gltf.materials
    const pbr = material.pbrMetallicRoughness as { baseColorFactor: number[] }
    assert.equal(material.alphaMode, 'BLEND')
    assert.deepEqual(pbr.baseColorFactor, [1, 1, 1, TANGENT_BLEND_ALPHA])
    assert.deepEqual(material.normalTexture, { index: 1 })
  }
})

test('an opaque scene keeps the source material as it is, a transmission aside', () => {
  assert.deepEqual(tangentSceneGltf(source(), false, 'paged').materials, source().materials)
  for (const path of ['unpaged', 'frame'] as const) {
    const { extensions, ...rest } = tangentSceneGltf(source(), false, path).materials[0]
    assert.ok(extensions)
    assert.deepEqual([rest], source().materials)
  }
})

test('only an unpaged or frame scene carries a transmission', () => {
  const paged = tangentSceneGltf(source(), true, 'paged')
  assert.equal(paged.materials[0].extensions, undefined)
  assert.equal(paged.extensionsUsed, undefined)
  for (const path of ['unpaged', 'frame'] as const) {
    const gltf = tangentSceneGltf(source(), false, path)
    assert.deepEqual(gltf.materials[0].extensions, {
      KHR_materials_transmission: { transmissionFactor: TANGENT_TRANSMISSION },
    })
    assert.deepEqual(gltf.extensionsUsed, ['KHR_materials_transmission'])
  }
})

test('only a frame scene loses its authored tangents', () => {
  for (const path of PATHS) {
    const { attributes } = tangentSceneGltf(source(), true, path).meshes[0].primitives[0]
    assert.equal('TANGENT' in attributes, path !== 'frame')
    assert.equal(attributes.NORMAL, 1)
  }
})
