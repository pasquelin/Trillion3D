// The surface boundary's contract on textures: a surface holds the texture record itself, the one
// record the pools, the atlases and the sampling words read, and its transform is composed as the
// reference composes it.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as G from '../../../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { importHostSurface } from '../../../../../../packages/sdk-browser/src/host/surfaceImport.ts'

const texture = () => G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, 'rgba')

test('A surface reads the texture record itself, no copy made', () => {
  const map = texture()
  assert.equal(importHostSurface(G.standardSurface({ map }))?.map, map)
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
  const record = importHostSurface(material)!.map!
  assert.deepEqual([...record.transform], expected, 'the same doubles')
})

test('A material is read in one place, and never cached: a replaced map is seen as it stands', () => {
  const material = G.standardSurface({ map: texture() })
  assert.equal(importHostSurface(material)?.map, material.map as G.Texture)
  const second = texture()
  material.map = second
  assert.equal(importHostSurface(material)?.map, second)
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
    const record = importHostSurface(new G.GraphSurface('phong', { shininess }))!
    assert.equal(record.roughness, roughness, `n = ${shininess}`)
    const alpha = record.roughness ** 2
    assert.ok(Math.abs(2 / alpha ** 2 - 2 - Math.max(0, shininess)) < 1e-12, `n = ${shininess}`)
  }
})
