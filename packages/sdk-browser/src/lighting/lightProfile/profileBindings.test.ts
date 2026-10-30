// The two bindings a program reads the light profiles through: a filterable 2D array and a filtering sampler.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createLightProfileAtlas } from './profileAtlas.ts'
import { lightProfileBindEntries, lightProfileLayoutEntries } from './profileBindings.ts'

test('the layout entries are a float 2D array and a filtering sampler, the bind entries the atlas’s view and sampler', () => {
  const b = { atlas: 5, sampler: 6 }
  const [texture, sampler] = lightProfileLayoutEntries(b, 4)
  assert.deepEqual(texture, {
    binding: 5,
    visibility: 4,
    texture: { sampleType: 'float', viewDimension: '2d-array' },
  })
  assert.deepEqual(sampler, { binding: 6, visibility: 4, sampler: { type: 'filtering' } })
  const atlas = createLightProfileAtlas(fakeDevice(BACKEND).device)
  assert.deepEqual(
    lightProfileBindEntries(b, {
      view: atlas.view,
      sampler: atlas.sampler,
      rectView: atlas.view,
      rectSampler: atlas.sampler,
    }),
    [
      { binding: 5, resource: atlas.view },
      { binding: 6, resource: atlas.sampler },
    ],
  )
})
