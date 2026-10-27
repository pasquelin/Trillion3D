// The water's depth drawn ahead of the lights (`encodeWaterDepth`) is the sun's marking to read for the
// image it was drawn for, and no other; targets remade hold none.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { waterDepthMarked, type WaterTargets } from './waterTargets.ts'

const waterDepth = {} as GPUTextureView,
  targetsOf = () => ({ depthAheadFor: 0, views: { waterDepth } }) as unknown as WaterTargets
const runtime = (frame: number, waterTargets?: WaterTargets) =>
  ({ run: { frame }, blendState: { waterTargets } }) as unknown as WebgpuPagesRuntime

test('the water depth drawn ahead is read for its image alone', () => {
  const targets = targetsOf()
  assert.equal(waterDepthMarked(runtime(1)), undefined, 'no targets yet')
  assert.equal(waterDepthMarked(runtime(1, targets)), undefined, 'nothing drawn yet')
  targets.depthAheadFor = 4
  assert.equal(waterDepthMarked(runtime(4, targets)), waterDepth)
  assert.equal(waterDepthMarked(runtime(5, targets)), undefined, 'the next image draws again')
  assert.equal(waterDepthMarked(runtime(4, targetsOf())), undefined, 'remade targets hold none')
})
