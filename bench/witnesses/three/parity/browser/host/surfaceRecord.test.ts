// The surface record's contract: it holds the texture record itself, the one record the pools, the
// atlases and the sampling words read, its transform composed as the reference composes it; and
// the witness draws each family a record was declared in as the reference draws that family.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as G from '../../../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { Color } from '../../../../../../packages/sdk-core/src/world/math/color.ts'
import { Vector2 } from '../../../../../../packages/sdk-core/src/world/math/vector2.ts'
import { threeMaterials } from '../../../fromSurface.ts'

const texture = () => G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, 'rgba')

test('A surface reads the texture record itself, no copy made', () => {
  const map = texture()
  assert.equal(G.standardSurface({ map }).map, map)
})

test('A write moves the one counter it belongs to, on the record the pools address', () => {
  const record = texture()
  const { version, sampling, placement } = record
  record.wrapS = 'repeat'
  record.anisotropy = 4
  assert.deepEqual(
    [record.version, record.sampling, record.placement],
    [version, sampling + 2, placement],
    'the sampler is set again, nothing sent',
  )
  record.needsUpdate = true
  assert.equal(record.version, version + 1, 'the picture is sent again')
  record.offset.set(0.25, 0.5)
  assert.deepEqual([record.placement, record.transform[6]], [placement + 1, 0.25], 'placed again')
})

// `KHR_texture_transform` is applied by the loader to the texture's offset, repeat and
// rotation: each write composes the transform, as the reference composes it at a centre of zero.
test('A texture transform is composed at its writes, as the reference composes it', () => {
  const map = G.dataTexture(new Uint8Array(4), 1, 1)
  map.offset.set(0.25, 0.5)
  map.repeat.set(2, 3)
  map.rotation = 0.5
  const material = G.standardSurface({ map })
  const expected = new THREE.Matrix3().setUvTransform(0.25, 0.5, 2, 3, 0.5, 0, 0).elements
  const record = material.map!
  assert.deepEqual(Array.from(record.transform), expected, 'the same doubles')
})

test('A map written on the record is the one every reader sees, the witness included', () => {
  const material = G.standardSurface({ map: texture() })
  const second = texture()
  material.map = second
  const drawn = threeMaterials(material) as THREE.MeshStandardMaterial
  assert.equal(drawn.map?.image, second.image, 'the witness samples the record as it stands')
})

// A Blinn–Phong exponent n is the GGX lobe of α² = 2 / (n + 2):
// the record holds the roughness the shaders square into α, (2 / (n + 2))^¼.
test('A Phong surface reads its exponent as the roughness of the GGX lobe that matches it', () => {
  for (const [shininess, roughness] of [
    [30, 0.5],
    [6, Math.SQRT1_2],
    [0, 1],
    [-3, 1],
  ]) {
    const record = G.familySurface('phong', { shininess })
    assert.equal(record.roughness, roughness, `n = ${shininess}`)
    const alpha = record.roughness ** 2
    assert.ok(Math.abs(2 / alpha ** 2 - 2 - Math.max(0, shininess)) < 1e-12, `n = ${shininess}`)
  }
})

// The engine draws every family through its one model; the witness draws each as the reference
// lights that family, from the facts the record keeps as declared.
test('The witness draws a Lambert, Phong and toon record as the reference draws that family', () => {
  const emissive = new Color().setRGB(0.25, 0.5, 0)
  const lambert = threeMaterials(G.familySurface('lambert', { color: 0x336699, emissive }))
  assert.ok(lambert instanceof THREE.MeshLambertMaterial)
  assert.deepEqual(lambert.emissive.toArray(), [0.25, 0.5, 0])
  assert.deepEqual(lambert.color.toArray(), new Color(0x336699).toArray())
  const specular = new Color().setRGB(0.5, 0.25, 0.125)
  const phong = threeMaterials(G.familySurface('phong', { shininess: 12, specular }))
  assert.ok(phong instanceof THREE.MeshPhongMaterial)
  assert.equal(phong.shininess, 12)
  assert.deepEqual(phong.specular.toArray(), [0.5, 0.25, 0.125])
  const plain = threeMaterials(G.familySurface('phong')) as THREE.MeshPhongMaterial
  // The record decodes the reference's default colour by the exact sRGB formula, the library by
  // its folded constants: the two doubles part in the twelfth digit, far below any f32 the GPU reads.
  assert.equal(plain.shininess, 30)
  const reference = new THREE.MeshPhongMaterial().specular.toArray()
  const drawn = plain.specular.toArray()
  const apart = Math.max(...drawn.map((channel, k) => Math.abs(channel - reference[k])))
  assert.ok(apart < 1e-9, 'an undeclared highlight is the reference default')
  const toon = threeMaterials(G.familySurface('toon', { side: 'double', opacity: 0.5 }))
  assert.ok(toon instanceof THREE.MeshToonMaterial)
  assert.deepEqual([toon.side, toon.opacity, toon.gradientMap], [THREE.DoubleSide, 0.5, null])
})

test('A record written for vertex tangents hands the witness its factors as declared', () => {
  const normalScale = new Vector2(1, 0.5)
  const record = G.standardSurface({ normalScale, forVertexTangents: true })
  assert.equal(record.normalScaleY, -0.5, 'the engine rebuilds the frame: the factor turned')
  const drawn = threeMaterials(record) as THREE.MeshStandardMaterial
  assert.deepEqual(drawn.normalScale.toArray(), [1, 0.5])
})
