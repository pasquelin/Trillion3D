// A run of compute steps encodes the same passes on a frame sampled for the GPU timing as on any other; only the detail (`gpuTimingDetail`) asks each step a pass of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ComputeRun } from './lazyComputePass.ts'
import { TIMED_APART, TIMED_ENCODER } from './timedEncoder.ts'
import {
  HIZ_PASS,
  RASTER_DEPTH_EXPORT_PASS,
  RASTER_OCCLUDER_DEPTH_PASS,
} from '../../diagnostic/stage/passLabels.ts'

/** An encoder that counts the compute passes begun on it, timed (`timed`) with each step apart (`apart`) or not. */
function encoderOf(timed: boolean, apart: boolean) {
  const passes: (string | undefined)[] = []
  const encoder = {
    [TIMED_ENCODER]: timed,
    [TIMED_APART]: apart,
    beginComputePass: (descriptor: GPUComputePassDescriptor) => (
      passes.push(descriptor.label),
      { end() {} }
    ),
  } as unknown as GPUCommandEncoder
  return { encoder, passes }
}
/** Steps the profile does not name: each is its own row, so a sampled frame cuts between them (below). */
const UNNAMED = [{ label: 'a' }, { label: 'b' }, { label: 'c' }]
/** Two steps of one stage and block of the profile: one row, one pass on any frame. */
const ONE_ROW = [{ label: RASTER_OCCLUDER_DEPTH_PASS }, { label: RASTER_DEPTH_EXPORT_PASS }]
const passesOf = (timed: boolean, apart: boolean, steps = UNNAMED) => {
  const { encoder, passes } = encoderOf(timed, apart)
  const run = new ComputeRun().begin(encoder)
  for (const step of steps) run.pass(step)
  run.end()
  return passes
}

test('a sampled frame encodes the passes of an unsampled one for the steps of one row of the profile: a run is one pass whatever the timing', () => {
  assert.deepEqual(passesOf(false, false), ['a'], 'an unsampled frame is one pass')
  assert.deepEqual(passesOf(false, false, ONE_ROW), [RASTER_OCCLUDER_DEPTH_PASS])
  assert.deepEqual(passesOf(true, false, ONE_ROW), passesOf(false, false, ONE_ROW))
})

test('the detail asks each step of a sampled frame a pass of its own, with its label', () => {
  assert.deepEqual(passesOf(true, true), ['a', 'b', 'c'])
  assert.deepEqual(passesOf(false, true), ['a'], 'an unsampled frame is never split')
})

test('on a sampled frame a step of another stage of the profile is a pass of its own, so that a stage’s time stays its own; an unsampled frame keeps its single pass', () => {
  const steps = [RASTER_OCCLUDER_DEPTH_PASS, RASTER_DEPTH_EXPORT_PASS, HIZ_PASS]
  const run = (timed: boolean) => {
    const { encoder, passes } = encoderOf(timed, false)
    const r = new ComputeRun().begin(encoder)
    for (const label of steps) r.pass({ label })
    r.end()
    return passes
  }
  assert.deepEqual(run(false), [RASTER_OCCLUDER_DEPTH_PASS])
  assert.deepEqual(
    run(true),
    [RASTER_OCCLUDER_DEPTH_PASS, HIZ_PASS],
    'the geometry steps share a pass, the pyramid’s is its own',
  )
})
