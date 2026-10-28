import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import {
  cascadeBlend,
  overBlurCorrection,
  pcf5x5,
  pcfWeights,
  receiverTransitionScale,
  transitionVisibility,
} from './pcf.fixture.ts'
import { CLASSIC_PCF_WGSL } from './pcfWgsl.ts'

test('a texel in front of the receiver by more than the ramp shadows it, one behind lights it, the ramp between', () => {
  assert.equal(transitionVisibility(0.5, 0.6, 60), 0)
  assert.equal(transitionVisibility(0.6, 0.5, 60), 1)
  assert.equal(transitionVisibility(0.5, 0.5, 60), 1)
  assert.ok(Math.abs(transitionVisibility(0.5 - 0.5 / 60, 0.5, 60) - 0.5) < 1e-9)
})

test('the window weighs its edge texels by the fraction and its whole by a twenty-fifth', () => {
  assert.deepEqual(pcfWeights(0.25), [0.75, 1, 1, 1, 1, 0.25])
  const lit = new Array(36).fill(1)
  assert.ok(Math.abs(pcf5x5(0.3, 0.7, lit) - 1) < 1e-12)
  assert.equal(pcf5x5(0.3, 0.7, new Array(36).fill(0)), 0)
  // The window is five texels wide whatever the fraction: the left column shadowed costs (1 - fx) of a fifth.
  const left = new Array(36).fill(1)
  for (let y = 0; y < 6; y++) left[y * 6] = 0
  assert.ok(Math.abs(pcf5x5(0.25, 0, left) - 0.85) < 1e-12)
})

test('the blur is corrected by the square, a cascade fades over its length, a grazing receiver takes the bias of its transition', () => {
  assert.equal(overBlurCorrection(0.5), 0.25)
  assert.equal(cascadeBlend(10, 20, 10), 1)
  assert.equal(cascadeBlend(25, 20, 10), 0.5)
  assert.equal(cascadeBlend(40, 20, 10), 0)
  assert.equal(cascadeBlend(40, 20, 0), 1)
  assert.equal(receiverTransitionScale(60, 0.9, 1), 60)
  assert.ok(Math.abs(receiverTransitionScale(60, 0.9, 0) - 6) < 1e-9)
})

test('the shader twin holds each function', () => {
  const code = wgslModule(CLASSIC_PCF_WGSL)
  for (const name of [
    'classicTransitionVisibility',
    'classicPcf5x5',
    'classicOverBlurCorrection',
    'classicCascadeBlend',
    'classicReceiverTransitionScale',
  ])
    assert.ok(code.includes(`fn ${name}(`), name)
})
