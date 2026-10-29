// The atlas is compressed by the block copy for modes 1 and 2 where the device has the BC formats, never for mode 0.
import test from 'node:test'
import assert from 'node:assert/strict'
import { atlasCompression } from './compress.ts'
import { BLOCK_FEATURES } from '../../materials/texture/blockFormats.ts'

const withBc = { features: new Set([BLOCK_FEATURES.bc7]) } as unknown as Pick<GPUDevice, 'features'>
const withoutBc = { features: new Set() } as unknown as Pick<GPUDevice, 'features'>

test('modes 1 and 2 compress by copy where the device has the block formats', () => {
  assert.equal(atlasCompression(withBc, 1).compressed, true)
  assert.equal(atlasCompression(withBc, 2).compressed, true)
})

test('mode 0 and a device without the block formats keep the atlas plain, with the reason', () => {
  assert.equal(atlasCompression(withBc, 0).compressed, false)
  const lacking = atlasCompression(withoutBc, 1)
  assert.equal(lacking.compressed, false)
  assert.match(lacking.why ?? '', /texture-compression-bc/)
})
