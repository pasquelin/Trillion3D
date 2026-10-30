// The cascade's programs over the scene and over the water: the water's read its own depth and run over the listed tiles.

import test from 'node:test'
import assert from 'node:assert/strict'
import { WATER_TILE_PIXELS } from '../../../../blend/water/waterLayout.ts'
import {
  FIELD_SHADOW_GROUP,
  fieldShadowTraceProgram,
  fieldShadowUpsampleProgram,
} from './fieldShadowWgsl.ts'

test('a workgroup of the water upsample is one tile of the water list', () => {
  assert.equal(FIELD_SHADOW_GROUP, WATER_TILE_PIXELS)
})

test('the scene programs read the depth pyramid and the water programs the water depth', () => {
  for (const program of [fieldShadowTraceProgram(), fieldShadowUpsampleProgram()]) {
    assert.match(program, /hizOpaqueDepth\(pixel\)/)
    assert.doesNotMatch(program, /waterDepth/)
  }
  for (const program of [fieldShadowTraceProgram('water'), fieldShadowUpsampleProgram('water')]) {
    assert.match(program, /textureLoad\(waterDepth,pixel,0\)/)
  }
})

test('the water upsample walks the list of tiles in rows and writes its layer outright', () => {
  const water = fieldShadowUpsampleProgram('water')
  assert.match(water, /flatIndex\(group,groups,1u\)/)
  assert.match(water, /rank>=waterCount\.x/)
  assert.match(water, /write>;/)
  assert.doesNotMatch(water, /min\(held/)
  assert.match(fieldShadowUpsampleProgram(), /min\(held,visibility\)/)
})

test('the water trace walks the list of tiles in rows and reaches the texel past a tile where the traced image is smaller than the window', () => {
  const water = fieldShadowTraceProgram('water')
  assert.match(water, /flatIndex\(group,groups,1u\)/)
  assert.match(water, /rank>=waterCount\.x/)
  assert.match(water, /8u\/factor\+1u/)
  const scene = fieldShadowTraceProgram()
  assert.match(scene, /global_invocation_id/)
  assert.doesNotMatch(scene, /waterTiles/)
})
