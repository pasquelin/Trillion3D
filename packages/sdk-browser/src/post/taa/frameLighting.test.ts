import test from 'node:test'
import assert from 'node:assert/strict'
import { TAA_SAMPLES } from './jitter.ts'
import { runtime } from './frame.fixture.ts'
import { stochasticPhase } from './frameState.ts'

test('quiet lighting samples do not repeat when the spatial jitter phases repeat', () => {
  const { temporal, frame } = runtime()
  const spatial = [],
    lighting = []
  frame(false) // The view's first image moves: nothing before it.
  for (let image = 0; image < 2 * TAA_SAMPLES; image++) {
    frame(true)
    spatial.push([...temporal.frame.jitter])
    lighting.push(temporal.frame.stochasticSample - 1)
  }
  assert.deepEqual(spatial.slice(0, TAA_SAMPLES), spatial.slice(TAA_SAMPLES))
  assert.equal(new Set(lighting).size, 2 * TAA_SAMPLES)
  assert.deepEqual(
    lighting,
    Array.from({ length: 2 * TAA_SAMPLES }, (_, i) => i + 1),
  )
})

test('lighting ranks belong to each view; a capture whose pass is off does not advance them, one that accumulates does', () => {
  const a = runtime(),
    b = runtime()
  a.frame(true)
  a.frame(true)
  b.frame(true)
  assert.equal(a.temporal.frame.stochasticSample, 2)
  assert.equal(b.temporal.frame.stochasticSample, 1)
  // The last image of a short capture, drawn with the pass off.
  a.rt.capture.capturing = true
  a.rt.gpu.temporalLevel = 'off'
  a.frame(true)
  assert.equal(a.temporal.frame.stochasticSample, 2)
  // An image of a capture that accumulates (the screenshot run-up of the reference) is an image like any.
  a.rt.gpu.temporalLevel = 'max'
  a.frame(true)
  assert.equal(a.temporal.frame.stochasticSample, 3)
})

test('the lighting sample advances once, at the image’s entry, the pass on or off', () => {
  const { rt, temporal, frame } = runtime()
  frame(true)
  assert.equal(temporal.frame.stochasticSample, 1)
  rt.gpu.temporalLevel = 'off'
  frame(true)
  assert.equal(temporal.frame.stochasticSample, 2)
})

test('the accumulated images meet the phases 1, 2, 3 in turn', () => {
  const { temporal, frame } = runtime()
  const phases = []
  for (let image = 0; image < 3; image++) {
    frame(true)
    phases.push(stochasticPhase(temporal.frame))
  }
  assert.deepEqual(phases, [1, 2, 3])
})

test('without temporal accumulation each image drawn meets another phase', () => {
  const { rt, temporal, frame } = runtime()
  rt.gpu.temporalLevel = 'off'
  const phases = []
  for (let image = 0; image < 3; image++) {
    frame(true)
    assert.equal(temporal.frame.active, false)
    phases.push(stochasticPhase(temporal.frame))
  }
  assert.equal(new Set(phases).size, 3)
  assert.deepEqual(phases, [1, 2, 3])
})

test('a view with no temporal state has the phase zero', () => {
  assert.equal(stochasticPhase(undefined), 0)
})
