import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { VECTOR_FORMAT } from './velocityWgsl.ts'
import { VOLUME_VELOCITY_WGSL, velocityTargetOf } from './volumeVelocity.ts'

/** A runtime whose view's velocity stage is `stage`, none where `stage` is undefined. */
const runtime = (stage?: object) => ({ gpu: { velocity: stage } }) as unknown as WebgpuPagesRuntime
const view = {} as GPUTextureView
const uniform = {} as GPUBuffer
const stage = (flags: { active: boolean; measured: boolean }) => ({
  ...flags,
  size: [64, 32],
  uniform,
  get vectors() {
    return view
  },
})

test('the volume writes no velocity while the image’s vectors are not produced', () => {
  assert.equal(velocityTargetOf(runtime()), undefined, 'no velocity stage in the view')
  assert.equal(velocityTargetOf(runtime(stage({ active: false, measured: true }))), undefined)
  assert.equal(velocityTargetOf(runtime(stage({ active: true, measured: false }))), undefined)
  // The target given back (`release` zeroes the size) is none, not a view that is not there.
  assert.equal(
    velocityTargetOf(runtime({ ...stage({ active: true, measured: true }), size: [0, 0] })),
    undefined,
  )
})

test('the vectors the stage drew, with the view it measured by, are the volume’s target', () => {
  const target = velocityTargetOf(runtime(stage({ active: true, measured: true })))
  assert.ok(target)
  assert.equal(target.view, view)
  assert.equal(target.format, VECTOR_FORMAT)
  assert.deepEqual(target.size, [64, 32])
  assert.equal(target.taaView, uniform)
})

test('a volume’s word is its own vector and the depth step alone, to the codec’s steps', () => {
  const { volumeVelocityWord, decodeVector, hasOwnMotion, depthStepOf } = shaderRun<{
    volumeVelocityWord: (v: number[], step: number) => number[]
    decodeVector: (word: number) => number[]
    hasOwnMotion: (word: number) => boolean
    depthStepOf: (word: number) => number
  }>(
    wgslProgram('', [VOLUME_VELOCITY_WGSL]),
    ['volumeVelocityWord', 'decodeVector', 'hasOwnMotion', 'depthStepOf'],
    {},
  )
  const v = [0.0123, -0.3071]
  const step = 0.00042
  const [vector, flags] = volumeVelocityWord(v, step)
  assert.ok(hasOwnMotion(vector), 'a vector written by a pass is the texel’s own motion')
  const got = decodeVector(vector)
  for (let axis = 0; axis < 2; axis++) {
    // One and a half codes of the 16-bit square-root curve at most (the lowest bit holds the mark).
    const bound = (1.5 * Math.sqrt(2 * Math.abs(v[axis]))) / (65535 * 0.2495) + 1e-7
    assert.ok(Math.abs(got[axis] - v[axis]) <= bound, `axis ${axis}: ${got[axis]} for ${v[axis]}`)
  }
  assert.equal(
    flags & 0xffff,
    0,
    'no pixel animation nor responsiveness flag: the texel is replaced whole',
  )
  assert.ok(Math.abs(depthStepOf(flags) - step) <= step * 2 ** -10 + 2 ** -25)
  // A depth step past a half float is held to the largest one, not left to the pack.
  const [, huge] = volumeVelocityWord(v, 1e9)
  assert.ok(Math.abs(depthStepOf(huge) - 65504) < 1)
})
