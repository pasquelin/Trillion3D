import test from 'node:test'
import assert from 'node:assert/strict'
import { TAA_SAMPLES } from './jitter.ts'
import { runtime } from './frame.fixture.ts'

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

test('lighting ranks belong to each view and a nonaccumulating capture does not advance them', () => {
  const a = runtime(),
    b = runtime()
  a.frame(true)
  a.frame(true)
  b.frame(true)
  assert.equal(a.temporal.frame.stochasticSample, 2)
  assert.equal(b.temporal.frame.stochasticSample, 1)
  a.rt.capture.capturing = true
  a.frame(true)
  assert.equal(a.temporal.frame.stochasticSample, 2)
})

test('a skipped resolve does not consume a lighting sample', () => {
  const { rt, temporal, frame } = runtime()
  rt.gpu.depthView = undefined
  frame(true)
  assert.equal(temporal.frame.stochasticSample, 0)
})
