// The main view's readback ring is admitted as every resource of the cut (`admitInto`): against
// everything the cut holds — its buffers and its record textures alike —, so a ring that would take
// the cut past its share is refused by name, whatever kind of resource holds the rest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { DAG_READBACK_SLOTS } from './layout.ts'
import { createMainReadbacks } from './mainReadbacks.ts'

const SLOT = 256,
  TEXTURES = 4096

const cutOf = (share: number) => ({
  buffers: [],
  textures: [{ bytes: TEXTURES }],
  device: fakeDevice().device,
  admit: () => {},
  share,
})

test('the ring fits beside the record textures, or is refused past the share', () => {
  const fits = TEXTURES + DAG_READBACK_SLOTS * SLOT
  const ring = createMainReadbacks(cutOf(fits), SLOT)
  assert.equal(ring.bytes, DAG_READBACK_SLOTS * SLOT, 'every slot made within the share')
  assert.throws(() => createMainReadbacks(cutOf(fits - 1), SLOT), /PAST_SHARE/)
})
