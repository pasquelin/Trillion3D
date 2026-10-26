// The surface record's contract: it holds the texture record itself, the one record the pools, the
// atlases and the sampling words read.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from './graph/graph.fixture.ts'
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts'

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

test('A record written for vertex tangents turns its normal scale factor', () => {
  const normalScale = new Vector2(1, 0.5)
  const record = G.standardSurface({ normalScale, forVertexTangents: true })
  assert.equal(record.normalScaleY, -0.5, 'the engine rebuilds the frame: the factor turned')
})
