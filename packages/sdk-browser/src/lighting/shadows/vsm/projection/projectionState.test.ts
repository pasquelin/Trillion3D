// The projection's view belongs to one set (`vsmProjectionReserve`): two sets on one device never share
// it, and freeing a set frees its own and nothing of the other's; the blue noise they read is the
// device's, made once and shared, never freed with a set.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuDeviceLedger } from '../../../../gpu/core/deviceLedger.ts'
import { blueNoiseTextures } from '../../../../gpu/noise/blueNoiseTextures.ts'
import { createVsmResources } from '../resources.ts'
import { fakeHizDepth } from '../hizDepth.fixture.ts'
import { holdToonProfile } from '../../../toon/registry.ts'
import { writeVsmProjectionFrame } from './projectionPass.ts'
import { projectionKit } from './projectionKit.fixture.ts'
import { camera } from './projectionScene.fixture.ts'
import { VSM_PROJECTION_VIEW_WORD } from './projectionView.ts'
import {
  releaseVsmProjection,
  vsmProjectionBytesToMake,
  vsmProjectionHeldBytes,
  vsmProjectionReserve,
} from './projectionStore.ts'

const OPTIONS = { coverMode: 'suns' as const, fullMapCapacity: 63, poolPages: 256 }

test('two sets on one device hold their own projection, each freed with its set, and read the one blue noise', async () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const noise = await blueNoiseTextures(device)
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
  assert.equal(a.projection?.blueNoiseView, noise.view, 'the noise is the device’s')
  assert.equal(b.projection?.blueNoiseView, noise.view)
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

test('the toon profiles’ extinctions are uploaded to the view uniform once, and again only when the collection changes', () => {
  const owner = { released: new Set<() => void>() }
  holdToonProfile(owner, { shadowExtinctionCoefficient: 30 }, true)
  const kit = projectionKit()
  const at = 4 * VSM_PROJECTION_VIEW_WORD.toonExtinction
  const toonWrites = () =>
    kit.writes.filter((w) => w.buffer.label === 'vsm.projection.view' && w.offset === at).length
  const frame = {
    device: kit.device,
    hizDepth: fakeHizDepth,
    width: 64,
    height: 32,
    camera,
    frameIndex: 1,
    lights: [],
  }
  writeVsmProjectionFrame(kit.res, frame)
  writeVsmProjectionFrame(kit.res, frame)
  assert.equal(toonWrites(), 1, 'one upload for two frames')
  const second = { released: new Set<() => void>() }
  holdToonProfile(second, { shadowExtinctionCoefficient: 50 }, true)
  writeVsmProjectionFrame(kit.res, frame)
  assert.equal(toonWrites(), 2, 'again after the collection changed')
  for (const hook of owner.released) hook()
  for (const hook of second.released) hook()
})
