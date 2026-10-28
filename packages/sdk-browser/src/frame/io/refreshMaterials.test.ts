// A surface the host rewrites in place (`setMaterial`) reaches its one record in the material table
// at the values refresh, which its clusters and items name: an opaque one's colour writes that
// record alone, no cluster record; a move between opaque and masked writes its clusters' records
// again.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FLAG_MASK,
  MATERIAL_RANK_MASK,
  PAGE_INFO_STRIDE,
  ROW_WORDS,
} from '../../visibility/types.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../../materials/table/materialLayout.ts'
import { BLEND_ITEM_SHIPPED } from '../../blend/itemLayout.fixture.ts'
import { materialRecordsSent } from '../../materials/table/materialRecordsSent.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND, writtenBytes } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { backendOf, quadScene, camera } from '../backend/testScenes.fixture.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { surfaceWritten } from '../../geometry/pages/surfaceWrites.ts'

test('a blended surface rewritten in place reaches its record at the values refresh', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, writes, textureWrites } = fakeDevice(BACKEND)
  fixture.material.transparent = true
  fixture.material.opacity = 0.5
  const backend = backendOf({
    ...fixture,
    gpuDevice: device,
  })
  /** The colour and opacity of the record the item names (its material word, `BlendItem.material`). */
  const rgba = () => {
    const last = writes.filter((w) => w.buffer.label === 'Trillion3D blend item records').at(-1)!
    const rank =
      new Uint32Array(writtenBytes(last).slice().buffer)[BLEND_ITEM_SHIPPED.at.material] &
      MATERIAL_RANK_MASK
    const words = new Float32Array(
        materialRecordsSent(textureWrites).at(-1)!.data.buffer as ArrayBuffer,
      ),
      at = rank * MATERIAL_RECORD_WORDS + MATERIAL_RECORD.at.baseColor
    return [...words.subarray(at, at + 3), words[at + 3]]
  }
  try {
    await backend.prepare()
    backend.render(camera())
    assert.deepEqual(rgba(), [1, 0, 0, 0.5])
    fixture.material.baseColor = [0, 0.5, 1]
    fixture.material.opacity = 0.25
    surfaceWritten(fixture.material)
    backend.refreshMaterials?.(true)
    backend.render(camera())
    assert.deepEqual(rgba(), [0, 0.5, 1, 0.25])
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

// A colour is a value of the record alone: the table writes the surface's one record (ten texels),
// and the decoded clusters that name it, which hold none of its values, are written by no host.
test('an opaque colour rewritten in place writes its one record and no cluster', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, writes, textureWrites } = fakeDevice(BACKEND)
  const backend = backendOf({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
  })
  const rowWrites = () =>
    writes.filter((w) => w.buffer.label === 'Trillion3D decoded clusters').length
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    backend.render(camera())
    const [rows, records] = [rowWrites(), textureWrites.length]
    fixture.material.baseColor = [0.25, 0.5, 0.75]
    surfaceWritten(fixture.material)
    backend.refreshMaterials?.(true)
    backend.render(camera())
    assert.equal(rowWrites(), rows, 'no cluster written')
    const sent = materialRecordsSent(textureWrites.slice(records))
    assert.equal(sent.length, 1, 'one write of the table')
    assert.deepEqual(sent[0].size, [MATERIAL_RECORD_WORDS / 4, 1, 1], 'of one record, one layer')
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

// A material moved between opaque and masked inside the session: the visibility passes
// draw both, told apart by the cluster's cutout flag.
test('an opaque surface turned masked cuts every cluster of its material', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, buffers } = fakeDevice(BACKEND)
  const backend = backendOf({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
  })
  const masked = () => {
    const table = buffers.findLast((buffer) => buffer.label === 'Trillion3D decoded clusters')!
    const ints = new Uint32Array(table.data.buffer, table.data.byteOffset, table.size / 4)
    const rows = Array.from({ length: table.size / PAGE_INFO_STRIDE }, (_, row) => row * ROW_WORDS)
    const drawn = rows.filter((base) => ints[base + PAGE_INFO.at.indexCount] > 0)
    assert.ok(drawn.length, 'the quad has clusters')
    return drawn.every((base) => (ints[base + PAGE_INFO.at.flags] & FLAG_MASK) !== 0)
  }
  try {
    await backend.prepare()
    backend.render(camera())
    assert.equal(masked(), false)
    fixture.material.alphaTest = 0.5
    surfaceWritten(fixture.material)
    backend.refreshMaterials?.(true, { surfaces: [fixture.material], from: 'opaque', to: 'mask' })
    // The masked class is asked at the next frame entry, the image held until it compiled.
    backend.render(camera())
    await backend.flush()
    assert.equal(masked(), true, 'every cluster of the material cuts at its cutoff')
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
