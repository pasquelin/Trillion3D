// The volumetric lightmap's sample spheres: their settings and the program.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { VOLUMETRIC_LIGHTMAP_RULES } from '../../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import {
  VISUALIZE_VIEWER_WORDS,
  VLM_VISUALIZE_WGSL,
  visualizeInstances,
  visualizeQuadIndices,
} from './visualizeWgsl.ts'

test('the sample spheres default to the reference', () => {
  const s = resolveSettings(VOLUMETRIC_LIGHTMAP_RULES, {})
  assert.equal(s.volumetricLightmapVisualize, false)
  assert.equal(s.volumetricLightmapVisualizeRadiusScale, 0.01)
  assert.equal(s.volumetricLightmapVisualizeMinScreenFraction, 0.001)
})

test('the program draws unlit surfaces from the lightmap in group 1', () => {
  assert.doesNotMatch(VLM_VISUALIZE_WGSL, /frag_depth/)
  assert.match(VLM_VISUALIZE_WGSL, /@location\(1\) flags:u32/)
  assert.match(VLM_VISUALIZE_WGSL, /@group\(1\) @binding\(0\) var<uniform> vlmView/)
  assert.equal(VISUALIZE_VIEWER_WORDS, 32)
})

test('eight quads an instance: forty-eight indices over thirty-two vertices, and the instances that cover the samples', () => {
  const indices = visualizeQuadIndices()
  assert.equal(indices.length, 48)
  assert.equal(Math.max(...indices), 31)
  assert.deepEqual([...indices.slice(0, 6)], [0, 1, 2, 2, 1, 3])
  assert.deepEqual([...indices.slice(42)], [28, 29, 30, 30, 29, 31])
  assert.equal(visualizeInstances(64), 8)
  assert.equal(visualizeInstances(65), 9)
  assert.equal(visualizeInstances(2 ** 31), Math.ceil(0x1fffffff / 8))
  assert.match(VLM_VISUALIZE_WGSL, /instance\*8u\+vertex\/4u/)
})
