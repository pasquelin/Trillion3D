// The material table is a record table (`../../gpu/core/recordTexture.ts`): it grows on the GPU,
// never by sending its records up again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialTable } from './materialTable.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_TEXELS, MATERIAL_TABLE } from './materialLayout.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { fromF32Bits } from '../../../../math/src/float/bits.ts'

const lit = () => ({ ...surfaceOf([]), lit: true })
const layers = () => ({
  mapLayer: new Map<Texture, number>(),
  dataLayer: new Map<Texture, number>(),
})

// Fails on the old code: a growth made a texture of its own and sent every record up again from
// the host, the first row's record among them.
test('the table grows by a GPU copy, no record sent again, the old texture retired at submit', () => {
  const { device, textureWrites, textureCopies, textures, destroyed, fences } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const rowRecords = 1 << MATERIAL_TABLE.rowShift,
    rowTexels = rowRecords * MATERIAL_RECORD_TEXELS
  table.word({ ...lit(), roughness: 0.5, version: 0 }, l)
  const first = table.upload(device),
    old = textures.at(-1)!
  assert.equal(old.height, 1)
  const sent = textureWrites.length
  for (let i = 1; i < rowRecords * 2 + 1; i++) table.word(lit(), l)
  assert.notEqual(table.upload(device), first)
  // Three rows hold the records; the first record moves on the GPU, the new ones alone are sent.
  const grown = textures.at(-1)!
  assert.deepEqual([grown.height, grown.width], [3, rowTexels])
  assert.deepEqual(
    textureCopies.map(({ from, to }) => [from.texture, to.texture]),
    [[old, grown]],
  )
  const after = textureWrites.slice(sent)
  assert.ok(after.every((write) => (write.destination.texture as unknown) === grown))
  assert.equal(
    after.some(({ destination }) => {
      const [x, y] = destination.origin as number[]
      return x === 0 && y === 0
    }),
    false,
    'the first record not sent again',
  )
  const roughness = grown.words![MATERIAL_RECORD.at.roughness]
  assert.equal(fromF32Bits(roughness), 0.5, 'copied on the GPU')
  // A pass of this image encoded earlier still binds the old view: its submit comes after.
  assert.equal(destroyed.includes(old), false, 'not destroyed while the image is encoded')
  assert.equal(fences(), 0, 'no promise per texture: the frame-end retire list holds it')
  destroyRetired(device)
  assert.equal(destroyed.includes(old), true, 'destroyed once the frame is submitted')
  table.dispose()
})
