// The projection's view and blue noise belong to one set (`vsmProjectionReserve`): two sets on
// one device never share them, and freeing a set frees its own and nothing of the other's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuDeviceLedger } from '../gpu/core/deviceLedger.ts'
import { createVsmResources } from './resources.ts'
import {
  releaseVsmProjection,
  vsmProjectionBytesToMake,
  vsmProjectionHeldBytes,
  vsmProjectionReserve,
} from './projectionPass.ts'

const OPTIONS = { fullMapCapacity: 63, poolPages: 256 }

test('two sets on one device hold their own projection, each freed with its set', () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const ledger = installGpuDeviceLedger(device)
  const a = createVsmResources(device, OPTIONS),
    b = createVsmResources(device, OPTIONS)
  const asked = vsmProjectionBytesToMake(undefined)
  assert.equal(vsmProjectionBytesToMake(a), asked, 'a set not reserved yet asks all of it')
  const before = ledger.bytes
  const viewA = vsmProjectionReserve(device, a).uniform
  assert.equal(ledger.bytes - before, asked, 'what it asked is what it made')
  assert.equal(vsmProjectionHeldBytes(a), asked)
  assert.equal(vsmProjectionBytesToMake(a), 0)
  const viewB = vsmProjectionReserve(device, b).uniform
  assert.notEqual(viewA, viewB, 'no view shared')
  releaseVsmProjection(a)
  assert.equal(ledger.bytes - before, asked, "only the first set's freed")
  assert.equal(vsmProjectionHeldBytes(a), 0)
  releaseVsmProjection(b)
  assert.equal(ledger.bytes, before)
  assert.deepEqual(
    Object.keys(ledger.snapshot().byLabel).filter((l) => /^vsm\.(projection\.|blueNoise)/.test(l)),
    [],
  )
})
