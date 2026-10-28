// A view's reflections that drew no image have seen none: the image numbers they keep start at "never", not at 0, which is the first image.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScreenReflection } from './gpu.ts'
import { vectorsReach } from './litImage.ts'
import { NEVER_SEEN } from '../../frame/backend/state/previousCamera.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

installGpuGlobals()

test('a new view’s reflections hold no lit image and no depth: their image numbers are "never"', () => {
  const reflection = createScreenReflection(fakeDevice().device, 4, 4, false)
  assert.equal(reflection.litFrame, NEVER_SEEN)
  assert.equal(reflection.depthImage, NEVER_SEEN)
  assert.equal(reflection.lit.held.image, NEVER_SEEN)
  assert.equal(vectorsReach(reflection.lit.held, 0), false, 'image 0 reaches back to no held image')
})
