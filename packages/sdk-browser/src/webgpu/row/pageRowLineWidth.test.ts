import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from '../pages/pages.ts'
import {
  FLAG_LINE,
  MATERIAL_RANK_MASK,
  PAGE_INFO_STRIDE,
  ROW_WORDS,
} from '../../visibility/types.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { quadScene, camera } from '../pages/testScenes.fixture.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../material/materialLayout.ts'

/** Each drawn row's line flag and the width its surface's record holds, after one frame of
 *  `scene`: the records as the table last sent them up. */
async function rowLineWidths(lineWidth: number | undefined) {
  installGpuGlobals()
  const scene = quadScene()
  if (lineWidth !== undefined) scene.material.lineWidth = lineWidth
  const { device, buffers, textureWrites } = fakeDevice(BACKEND)
  const backend = webgpuPagesEngine({
    ...scene,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  })
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush?.()
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table')!
    const ints = new Uint32Array(table.data.buffer, table.data.byteOffset, table.size / 4)
    const sent = textureWrites.findLast(
      ({ destination }) =>
        (destination.texture as { label?: string }).label === 'Trillion3D material records',
    )!
    const records = new Float32Array(sent.data.buffer as ArrayBuffer)
    const rows: { line: boolean; width: number }[] = []
    for (let row = 0; row < table.size / PAGE_INFO_STRIDE; row++) {
      const base = row * ROW_WORDS
      if (!ints[base + PAGE_INFO.at.indexCount]) continue
      const rank = ints[base + PAGE_INFO.at.material] & MATERIAL_RANK_MASK
      rows.push({
        line: (ints[base + PAGE_INFO.at.flags] & FLAG_LINE) !== 0,
        width: records[rank * MATERIAL_RECORD_WORDS + MATERIAL_RECORD.at.lineWidth],
      })
    }
    return rows
  } finally {
    await backend.dispose()
    scene.geometry.dispose()
    scene.material.dispose()
  }
}

// A row says it draws a line (`FLAG_LINE`), and its surface's record carries the width its quads
// widen to, zero on a surface that draws triangles.
test("a line page's row names its surface's width, a triangle page's zero and no line", async () => {
  const lines = await rowLineWidths(2.5)
  assert.ok(lines.length > 0)
  for (const row of lines) assert.deepEqual(row, { line: true, width: 2.5 })
  for (const row of await rowLineWidths(undefined)) assert.deepEqual(row, { line: false, width: 0 })
})
