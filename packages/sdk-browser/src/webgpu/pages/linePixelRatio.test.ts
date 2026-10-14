import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { quadScene, camera } from './testScenes.fixture.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { FLAG_MASK, MATERIAL_RANK_MASK } from '../../visibility/types.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../material/materialLayout.ts'
import { BLEND_ITEM_SHIPPED } from '../blend/itemLayout.fixture.ts'
import { materialRecordsSent } from '../material/materialRecordsSent.fixture.ts'

/** The words of the buffer `label` names, after the frames of a line surface 2.5 CSS pixels wide
 *  at a pixel ratio of 2, and the record of rank `rank` (`MATERIAL_RECORD`) as the material table
 *  last sent it up; `transparent` draws through the blend pass, and `dashed` gives the line a dash
 *  of 0.25 and a gap of 0.5. */
async function frameWords(transparent = false, dashed = false) {
  installGpuGlobals()
  const scene = quadScene()
  scene.material.lineWidth = 2.5
  if (dashed) Object.assign(scene.material, { dashSize: 0.25, gapSize: 0.5 })
  if (transparent) Object.assign(scene.material, { transparent: true, opacity: 0.5 })
  const { device, buffers, textureWrites } = fakeDevice(BACKEND)
  const backend = webgpuPagesEngine({
    ...scene,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelRatio: () => 2,
  })
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    backend.render(camera())
    await backend.flush()
    const sent = materialRecordsSent(textureWrites).at(-1)
    assert.ok(sent, 'the material records')
    const records = new Float32Array(sent.data.buffer as ArrayBuffer)
    const words = (label: string) => {
      const buffer = buffers.find((candidate) => candidate.label === label)
      assert.ok(buffer, label)
      return new Float32Array(buffer.data.buffer, buffer.data.byteOffset, buffer.size / 4)
    }
    /** The record the word `at` of buffer `label` names. */
    const record = (label: string, at: number) => {
      const rank = new Uint32Array(words(label).buffer, words(label).byteOffset)[at]
      const base = (rank & MATERIAL_RANK_MASK) * MATERIAL_RECORD_WORDS
      return records.subarray(base, base + MATERIAL_RECORD_WORDS)
    }
    return { words, record }
  } finally {
    await backend.dispose()
    scene.geometry.dispose()
    scene.material.dispose()
  }
}

// #348: a line's width counts CSS pixels: every WebGPU pass that widens a line reads the host's
// pixel ratio, and the shared `lineClip` draws width × ratio.
test('the rasters, the resolve and the blend pass read the host pixel ratio', async () => {
  const { words } = await frameWords()
  assert.equal(words('Trillion3D visibility uniforms')[24], 2, 'Uniforms.pixelRatio')
  assert.equal(words('Trillion3D resolve uniform')[18], 2, 'ShadeUni.pixelRatio')
  const blend = await frameWords(true)
  assert.equal(blend.words('Trillion3D blend view uniform')[31], 2, 'BlendView.pixelRatio')
  const item = blend.record('Trillion3D blend item records', BLEND_ITEM_SHIPPED.at.material)
  assert.equal(item[MATERIAL_RECORD.at.lineWidth], 2.5, "the item's record: Material.lineWidth")
})

// #359: a dashed line's dash and gap reach every WebGPU path that draws it — the record a page row
// names, which both rasters cut it by (a masked row, of threshold zero), and the record a blend
// item names —; a solid line's words stay zero, and its row is not masked.
test('a dashed line writes its dash and gap where every WebGPU path reads them', async () => {
  for (const dashed of [false, true]) {
    const dash = dashed ? [0.25, 0.5] : [0, 0]
    const { words, record } = await frameWords(false, dashed)
    const row = words('Trillion3D page table'),
      own = record('Trillion3D page table', PAGE_INFO.at.material)
    const at = MATERIAL_RECORD.at
    assert.deepEqual([...own.subarray(at.dash, at.dash + 2)], dash, 'Material.dash')
    const flags = new Uint32Array(row.buffer, row.byteOffset, row.length)[PAGE_INFO.at.flags]
    assert.equal((flags & FLAG_MASK) !== 0, dashed, 'the cutout reads it')
    assert.equal(own[at.cut], dashed ? 0 : 1, 'no alpha threshold beside the gaps')
    const blend = await frameWords(true, dashed)
    const item = blend.record('Trillion3D blend item records', BLEND_ITEM_SHIPPED.at.material)
    assert.deepEqual([...item.subarray(at.dash, at.dash + 2)], dash)
  }
})
