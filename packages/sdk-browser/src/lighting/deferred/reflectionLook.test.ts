// The look of the light a surface reflects (`View.reflection`): a contrast and a scale of 1 until the reflections say otherwise, then the settings'.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredView, ZERO_DIRECT } from './view.ts'
import { VIEW_LAYOUT } from './worldAtWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { defaultReflections } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'

const OFFSET = VIEW_LAYOUT.at.reflection * 4

test('the view starts at a contrast of 1 and a scale of 1, and a look is written when it changes', () => {
  const gpu = fakeDevice()
  const view = createDeferredView(gpu.device)
  const written = () => gpu.writes.filter((write) => write.offset === OFFSET)
  // The whole view is written once an image: its look is in it as made.
  view.write(
    new Float32Array(16),
    [0, 0, 0, 1],
    4,
    4,
    { r: 0, g: 0, b: 0, a: 1 },
    false,
    ZERO_DIRECT,
  )
  const whole = gpu.writes.at(-1)!.data as ArrayLike<number>
  assert.deepEqual(
    [...Array.from(whole).slice(VIEW_LAYOUT.at.reflection, VIEW_LAYOUT.at.reflection + 2)],
    [1, 1],
  )
  view.writeReflectionLook(1, 1)
  assert.equal(written().length, 0, 'the look it has: nothing to write')
  view.writeReflectionLook(0.5, 2)
  assert.deepEqual([...new Float32Array(written()[0].data as ArrayLike<number>)], [0.5, 2])
  view.writeReflectionLook(0.5, 2)
  assert.equal(written().length, 1, 'the same look writes nothing')
})

test('the reflections’ settings hold the contrast and the scale, 1 and 1 by default', () => {
  const settings = defaultReflections()
  assert.equal(settings.contrast, 1)
  assert.equal(settings.specularScale, 1)
})
