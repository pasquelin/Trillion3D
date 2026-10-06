import test from 'node:test'
import assert from 'node:assert/strict'
import { TAA_SAMPLES } from './jitter.ts'
import { runtime } from './frame.fixture.ts'

test('a shadow arriving before resolve rejects old still shading in that same image', () => {
  const { rt, temporal, frame } = runtime()
  for (let i = 0; i < 5; i++) frame(true)
  assert.equal(temporal.frame.hasHistory, true)
  rt.lights.vsm!.settle.renderedTotal++
  const uniform = frame(true)!
  assert.equal(uniform[37], 0, 'the landing image reads no old shadow history')
  assert.equal(temporal.frame.shadowsSeen, 1)
  assert.equal(frame(true)![37], 0, 'the full phase cycle restarts from its first sample')
  assert.equal(frame(true)![37], 1, 'subsequent samples accumulate the current shading')
})

test('quiet lighting samples do not repeat when the spatial jitter phases repeat', () => {
  const { temporal, frame } = runtime()
  const spatial = [],
    lighting = []
  for (let image = 0; image < 2 * TAA_SAMPLES; image++) {
    frame(true)
    spatial.push([...temporal.frame.jitter])
    lighting.push(temporal.frame.stochasticSample - 1)
  }
  assert.deepEqual(spatial.slice(0, TAA_SAMPLES), spatial.slice(TAA_SAMPLES))
  assert.equal(new Set(lighting).size, 2 * TAA_SAMPLES)
  assert.deepEqual(
    lighting,
    Array.from({ length: 2 * TAA_SAMPLES }, (_, i) => i),
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
