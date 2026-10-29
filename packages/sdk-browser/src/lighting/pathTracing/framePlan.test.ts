// The stages an image of the path tracer runs, in the order the reference runs them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { PATH_TRACING_RULES } from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import { planPathTracingFrame } from './framePlan.ts'

const plan = (
  options: Parameters<typeof resolveSettings<typeof PATH_TRACING_RULES>>[1],
  iteration = 0,
  lastDenoiserMode = 1,
  hasHistory = false,
  size: [number, number] = [1920, 1080],
) =>
  planPathTracingFrame(
    resolveSettings(PATH_TRACING_RULES, options),
    { iteration, lastDenoiserMode, hasHistory },
    size,
  )

test('a first sample clears, traces and displays; the denoiser waits for the last sample', () => {
  const frame = plan({ pathTracing: true })
  assert.deepEqual(frame.stages, ['clear', 'trace', 'denoiserPrepass', 'display'])
  assert.equal(frame.denoise, false)
})

test('the last sample denoises: the spatial stage, then the temporal one when a denoised image is held', () => {
  const last = { pathTracingSamplesPerPixel: 4, pathTracingTemporalDenoiser: true }
  assert.deepEqual(plan(last, 3).stages, [
    'clear',
    'trace',
    'denoiserPrepass',
    'spatialDenoiser',
    'display',
  ])
  assert.deepEqual(plan(last, 3, 1, true).stages.slice(-3), [
    'spatialDenoiser',
    'temporalDenoiser',
    'display',
  ])
})

test('camera-space normals are converted before the spatial stage', () => {
  const stages = plan(
    { pathTracingSamplesPerPixel: 4, pathTracingDenoiserNormalSpace: 1 },
    3,
  ).stages
  assert.ok(stages.indexOf('normalSpace') < stages.indexOf('spatialDenoiser'))
})

test('once the samples are gathered nothing is traced, and the denoiser runs when it is turned on', () => {
  const done = { pathTracingSamplesPerPixel: 4 }
  assert.deepEqual(plan(done, 4, 1).stages, ['denoiserPrepass', 'display'])
  assert.deepEqual(plan(done, 4, 0).stages, ['denoiserPrepass', 'spatialDenoiser', 'display'])
  assert.deepEqual(plan({ ...done, pathTracingDenoiser: false }, 4, 1).stages, ['display'])
})

test('the online mode denoises every image', () => {
  assert.equal(plan({ pathTracingTemporalDenoiserMode: 2 }, 0).denoise, true)
})

test('adaptive sampling needs the experimental modes; its mask comes from the second sample, its mips after the trace', () => {
  assert.equal(plan({ pathTracingAdaptiveSampling: true }).adaptive, false)
  const on = { pathTracingAdaptiveSampling: true, pathTracingExperimental: true }
  assert.deepEqual(plan(on, 0).stages.slice(0, 3), ['clear', 'trace', 'adaptiveErrorMips'])
  assert.deepEqual(plan(on, 1).stages.slice(0, 4), [
    'clear',
    'adaptiveMask',
    'trace',
    'adaptiveErrorMips',
  ])
})

test('the error chain has up to five levels, fewer for a small view', () => {
  assert.equal(plan({}, 0, 1, false, [1920, 1080]).varianceMips, 5)
  assert.equal(plan({}, 0, 1, false, [8, 100]).varianceMips, 4)
  assert.equal(plan({}, 0, 1, false, [1, 1]).varianceMips, 1)
})
