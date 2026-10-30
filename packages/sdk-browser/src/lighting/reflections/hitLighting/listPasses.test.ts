// The resources of the hit lighting's lists (`listPasses.ts`) kept across images, and the stages of the list shared by every host.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuDeviceLedger } from '../../../gpu/core/deviceLedger.ts'
import { SHRINK_AFTER_UPDATES } from '../../../gpu/core/keptOrMade.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import { hitLightingKernels, litListStages } from './kernels.ts'
import { admitLitListResources } from './listPasses.ts'

const LABEL = 'test hit lighting lists'

test('the lists are kept while they hold the rays asked and made again, the held ones given back, past them', () => {
  const { device } = fakeDevice()
  const first = admitLitListResources(device, undefined, LABEL, 1000)!
  assert.equal(first.capacity, 1000)
  // Fewer rays each image (the tiles a cache image traces vary): the same buffers serve, no churn.
  assert.equal(admitLitListResources(device, first, LABEL, 900), first)
  assert.equal(admitLitListResources(device, first, LABEL, 1000), first)
  const grown = admitLitListResources(device, first, LABEL, 1001)!
  assert.notEqual(grown, first)
  assert.equal(grown.capacity, 1001)
})

test('the lists shrink once the images have asked a quarter of their rays for a run, and a larger ask starts the run over', () => {
  const { device } = fakeDevice()
  const full = admitLitListResources(device, undefined, LABEL, 4000)!
  let held = full
  for (let image = 1; image < SHRINK_AFTER_UPDATES; image++)
    held = admitLitListResources(device, held, LABEL, 1000)!
  assert.equal(held, full, 'the run is one image short')
  held = admitLitListResources(device, held, LABEL, 4000)!
  assert.equal(held, full, 'an ask that fills them starts the run over')
  for (let image = 1; image < SHRINK_AFTER_UPDATES; image++)
    held = admitLitListResources(device, held, LABEL, 1000)!
  assert.equal(held, full)
  held = admitLitListResources(device, held, LABEL, 1000)!
  assert.notEqual(held, full)
  assert.equal(held.capacity, 1000)
})

test('a shrink the budget refuses keeps the working lists, not none', () => {
  const { device } = fakeDevice()
  let limit = 1e12
  installGpuDeviceLedger(device, { limit: () => limit })
  const full = admitLitListResources(device, undefined, LABEL, 4000)!
  limit = 1
  let held = full
  for (let image = 0; image <= SHRINK_AFTER_UPDATES; image++)
    held = admitLitListResources(device, held, LABEL, 1000)!
  assert.equal(held, full, 'the shrink refused keeps them')
})

test('the list’s stages are compiled once a device, whatever the format of the light or the set of masks', () => {
  const { device, pipelineLayouts } = fakeDevice()
  const stages = litListStages(device)
  assert.equal(litListStages(device), stages)
  const before = pipelineLayouts.length
  const first = hitLightingKernels(device, WORD_LIGHT_FORMAT)
  const second = hitLightingKernels(device, 'rgba16float')
  assert.notEqual(first, second)
  assert.equal(first.layer(0).list, second.layer(1).list)
  assert.equal(first.layer(0).list, stages)
  // The compaction once, then per format the first and second passes of both surfaces; the list's four were made with `litListStages`.
  assert.equal(pipelineLayouts.length - before, 4 + 4 + 1)
})
