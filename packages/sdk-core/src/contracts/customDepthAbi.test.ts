import test from 'node:test'
import assert from 'node:assert/strict'
import {
  customDepthWord,
  isCustomDepthStencilValue,
  isCustomDepthStencilWriteMask,
} from './customDepthAbi.ts'
import { CUSTOM_DEPTH_RULES } from './customDepthOptions.ts'
import { resolveSettings } from './settingRules.ts'
import { object } from '../world/object/index.ts'
import { geometry } from '../world/geometry/index.ts'
import { offsetSwitchesSet } from '../world/object/offsetSwitches.ts'

const RENDER = 1 << 16

test('the settings default to the reference values', () => {
  const settings = resolveSettings(CUSTOM_DEPTH_RULES, {})
  assert.equal(settings.customDepth, 1)
  assert.equal(settings.customDepthOrder, 2)
  assert.equal(settings.customDepthTemporalAAJitter, true)
  assert.equal(settings.customDepthEnableFastClear, false)
})

test('an object that does not ask has no word; one that asks carries value, mask and request', () => {
  assert.equal(customDepthWord(false, 7, 255), 0)
  assert.equal(customDepthWord(true, 0, 'default'), RENDER)
  assert.equal(customDepthWord(true, 5, 'default'), RENDER | 5)
  assert.equal(customDepthWord(true, 5, 255), RENDER | (255 << 8) | 5)
  assert.equal(customDepthWord(true, 255, 4), RENDER | (4 << 8) | 255)
})

test('the stencil value and the mask are checked', () => {
  for (const value of [0, 1, 255]) assert.ok(isCustomDepthStencilValue(value))
  for (const value of [-1, 256, 1.5, '1']) assert.ok(!isCustomDepthStencilValue(value))
  for (const mask of ['default', 255, 1, 128]) assert.ok(isCustomDepthStencilWriteMask(mask))
  for (const mask of [0, 3, 256, 'all']) assert.ok(!isCustomDepthStencilWriteMask(mask))
})

test('an object holds the three properties, saved only off their defaults', () => {
  const mesh = object.mesh(geometry.box(1, 1, 1))
  assert.equal(mesh.renderCustomDepth, false)
  assert.equal(mesh.customDepthStencilValue, 0)
  assert.equal(mesh.customDepthStencilWriteMask, 'default')
  assert.deepEqual(offsetSwitchesSet(mesh), {})
  mesh.renderCustomDepth = true
  mesh.customDepthStencilValue = 3
  mesh.customDepthStencilWriteMask = 8
  assert.deepEqual(offsetSwitchesSet(mesh), {
    renderCustomDepth: true,
    customDepthStencilValue: 3,
    customDepthStencilWriteMask: 8,
  })
  assert.throws(() => (mesh.customDepthStencilValue = 256), RangeError)
  assert.throws(() => (mesh.customDepthStencilWriteMask = 3 as never), RangeError)
})
