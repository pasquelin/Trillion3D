// The translucency lighting volume's debug views: their settings, the held cascades and the programs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { holdCascade, newCascade } from './bounds.ts'
import { injectProgram } from './injectWgsl.ts'
import {
  DEBUG_CULL_WORDS,
  TV_DEBUG_CULL_WGSL,
  TV_DEBUG_VISUALIZE_WGSL,
  debugGroups,
} from './debugWgsl.ts'

test('the debug settings default to the reference', () => {
  const s = resolveSettings(TRANSLUCENCY_VOLUME_RULES, {})
  assert.equal(s.translucencyVolumeVisualize, false)
  assert.equal(s.translucencyVolumeVisualizeRadiusScale, 2)
  assert.equal(s.translucencyVolumeVisualizeCascadeIndex, -1)
  assert.equal(s.translucencyVolumeDebug, false)
  assert.equal(s.translucencyVolumeDebugFreezePosition, false)
})

test('a held cascade keeps its box and follows the cells count', () => {
  const cascade = newCascade()
  assert.equal(holdCascade(cascade, 64), false, 'nothing placed yet')
  cascade.size = 32
  cascade.min[0] = 5
  assert.equal(holdCascade(cascade, 16), true)
  assert.equal(cascade.voxel, 2)
  assert.equal(cascade.min[0], 5)
})

test('the debug dispatch covers the cube', () => {
  assert.deepEqual(debugGroups(64), [16, 256])
  assert.deepEqual(debugGroups(30), [8, 64])
})

test('the spheres keep the raster depth of their cubes and read no scene depth', () => {
  assert.doesNotMatch(TV_DEBUG_VISUALIZE_WGSL, /frag_depth/)
  assert.doesNotMatch(TV_DEBUG_VISUALIZE_WGSL, /sceneDepth/)
})

test('the cells are counted marked only where the marks are made', () => {
  assert.equal(DEBUG_CULL_WORDS, 24)
  assert.match(TV_DEBUG_CULL_WGSL, /if\(cull\.marked!=0u\)\{\s*if\(textureLoad\(tvMarks/)
})

test('the spheres do not multiply the pre-exposure again: the volume is written with it', () => {
  assert.match(injectProgram(false), /ambient\.rgb\*tv\.weights\.x/)
  assert.doesNotMatch(TV_DEBUG_VISUALIZE_WGSL, /preExposure|tv\.weights/)
})
