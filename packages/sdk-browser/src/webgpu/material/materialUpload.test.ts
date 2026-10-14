// An upload sends the records written since through the engine's one run writer (`writeRanges`):
// two records far apart are two writes, never the span between them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialTable } from './materialTable.ts'
import { MATERIAL_RECORD_TEXELS } from './materialLayout.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const lit = () => ({ ...surfaceOf([]), lit: true })
const layers = () => ({
  mapLayer: new Map<Texture, number>(),
  dataLayer: new Map<Texture, number>(),
})

test('two records far apart are sent apart, never the records between them', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const surfaces = Array.from({ length: 10 }, (_, i) => ({ ...lit(), version: i }))
  for (const surface of surfaces) table.word(surface, l)
  table.viewFor(device)
  const before = textureWrites.length
  for (const [i, version] of [
    [1, 20],
    [8, 21],
  ]) {
    surfaces[i].roughness = 0.5
    surfaces[i].version = version
    table.word(surfaces[i], l)
  }
  table.viewFor(device)
  assert.deepEqual(
    textureWrites.slice(before).map((sent) => [sent.destination.origin, sent.size]),
    [1, 8].map((rank) => [
      [rank * MATERIAL_RECORD_TEXELS, 0, 0],
      [MATERIAL_RECORD_TEXELS, 1, 1],
    ]),
  )
})
