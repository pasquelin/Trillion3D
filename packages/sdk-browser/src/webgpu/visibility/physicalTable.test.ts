import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhysicalTable, PHYSICAL_ROW_RECORDS } from './physicalTable.ts'
import { visMaterial } from '../../visibility/shader/material.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

/** A record's words, as the upload lays them out: a row's words over the records it holds. */
const recordWords = (sent: { layout: GPUTexelCopyBufferLayout }) =>
  sent.layout.bytesPerRow! / 4 / PHYSICAL_ROW_RECORDS

/** The collector, called on demand: what the open world's churn waits for. */
function gcOf() {
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as (() => void) | undefined
}

const map = (channel: number) => ({ channel }) as Texture
const lit = { ...visMaterial([]), lit: true }

test('a surface without a lobe takes no record; one with a lobe takes its rank plus one', () => {
  const table = createPhysicalTable()
  const layer = new Map<Texture, number>()
  assert.equal(table.rowWord(lit, layer), 0)
  assert.equal(table.rowWord({ ...lit, clearcoat: 1, lit: false }, layer), 0)
  const coated = { ...lit, clearcoat: 1 },
    brushed = { ...lit, anisotropy: 0.5 }
  assert.equal(table.rowWord(coated, layer), 1)
  assert.equal(table.rowWord(brushed, layer), 2)
  // A surface keeps its record, and its rows all name it.
  assert.equal(table.rowWord(coated, layer), 1)
})

test('a record holds the clamped factors, the coat normal scales, the slots and the UV channels', () => {
  const { device, texelWrites } = fakeDevice()
  const table = createPhysicalTable()
  const anisotropyMap = map(1),
    clearcoatNormalMap = map(0)
  const layer = new Map([
    [anisotropyMap, 3],
    [clearcoatNormalMap, 7],
  ])
  const surface = {
    ...lit,
    anisotropy: 1.5,
    anisotropyRotation: 0.25,
    clearcoat: -1,
    clearcoatRoughness: 0,
    clearcoatNormalScale: [2, -1] as const,
    anisotropyMap,
    clearcoatNormalMap,
  }
  table.rowWord(surface, layer)
  const view = table.upload(device)
  assert.equal(texelWrites.length, 1)
  // One record: three texels of the first row.
  assert.deepEqual(texelWrites[0].size, [3, 1])
  const recordLength = recordWords(texelWrites[0])
  // The one record's write is its own texels: four words each.
  assert.equal(recordLength, (texelWrites[0].size as number[])[0] * 4)
  const words = new Uint32Array(texelWrites[0].data.buffer, 0, recordLength)
  const floats = new Float32Array(words.buffer, 0, recordLength)
  assert.deepEqual([...floats.slice(0, 6)], [1, 0.25, 0, Math.fround(ROUGHNESS_FLOOR), 2, -1])
  assert.deepEqual([...words.slice(6)], [0b0001, 0, 3, 0, 0, 7])
  // Nothing changed: nothing goes up again, and the texture stays.
  table.rowWord(surface, layer)
  assert.equal(table.upload(device), view)
  assert.equal(texelWrites.length, 1)
})

test('the table grows by doubling its rows, its texture with it, every record sent up again', () => {
  const { device, texelWrites, textures } = fakeDevice()
  const table = createPhysicalTable()
  const layer = new Map<Texture, number>()
  table.rowWord({ ...lit, clearcoat: 1 }, layer)
  const first = table.upload(device)
  assert.equal(textures.at(-1)!.height, 1)
  const records = PHYSICAL_ROW_RECORDS * 2 + 1
  for (let i = 1; i < records; i++) table.rowWord({ ...lit, clearcoat: 1 }, layer)
  const grown = table.upload(device)
  assert.notEqual(grown, first)
  // Three rows hold the records; the texture doubles to four.
  assert.equal(textures.at(-1)!.height, 4)
  assert.equal(textures.at(-1)!.width, PHYSICAL_ROW_RECORDS * 3)
  assert.deepEqual(texelWrites.at(-1)!.size, [PHYSICAL_ROW_RECORDS * 3, 3])
  // The data covers every row written: a row is its records' three texels of 16 bytes.
  assert.ok(texelWrites.at(-1)!.data.byteLength >= 3 * PHYSICAL_ROW_RECORDS * 3 * 16)
  table.dispose()
})

test('a grown table destroys its old texture only once the queue has done its submitted work', async () => {
  const { device, textures, destroyed, fences } = fakeDevice()
  const table = createPhysicalTable()
  const layer = new Map<Texture, number>()
  table.rowWord({ ...lit, clearcoat: 1 }, layer)
  table.upload(device)
  const old = textures.at(-1)!
  for (let i = 0; i < PHYSICAL_ROW_RECORDS; i++) table.rowWord({ ...lit, clearcoat: 1 }, layer)
  table.upload(device)
  // A pass of this image encoded earlier still binds the old view: its submit comes after.
  assert.notEqual(textures.at(-1), old)
  assert.equal(destroyed.includes(old), false, 'not destroyed while the image is encoded')
  assert.equal(fences(), 1, 'its destroy waits for the queue')
  await device.queue.onSubmittedWorkDone()
  assert.equal(destroyed.includes(old), true, 'destroyed once the submitted work is done')
  table.dispose()
})

test('a surface whose version and atlas held keeps its word: no record is compared again', () => {
  const { device, texelWrites } = fakeDevice()
  const table = createPhysicalTable()
  const layer = new Map<Texture, number>()
  const surface = { ...lit, clearcoat: 1, version: 3 }
  assert.equal(table.rowWord(surface, layer), 1)
  table.upload(device)
  // A field written without its version moving is not read: the version says what is current.
  surface.clearcoat = 0.5
  assert.equal(table.rowWord(surface, layer), 1)
  assert.equal(table.pending, false)
  // A new version is read again, its record sent up.
  surface.version = 4
  assert.equal(table.rowWord(surface, layer), 1)
  assert.equal(table.pending, true)
  table.upload(device)
  assert.equal(new Float32Array(texelWrites.at(-1)!.data.buffer)[2], 0.5)
  // A slot that moved under the same count (a texture released, another appended) is read again
  // once the atlas says so (`forget`), not before.
  const map = { channel: 0 } as Texture
  surface.clearcoatMap = map
  surface.version = 5
  layer.set(map, 5)
  table.rowWord(surface, layer)
  table.upload(device)
  layer.set(map, 2)
  table.rowWord(surface, layer)
  assert.equal(table.pending, false)
  table.forget()
  table.rowWord(surface, layer)
  table.upload(device)
  const last = texelWrites.at(-1)!
  assert.equal(new Uint32Array(last.data.buffer, last.layout.offset)[9], 2)
})

test('an upload sends the span of the records written since, not the whole table', () => {
  const { device, texelWrites } = fakeDevice()
  const table = createPhysicalTable()
  const layer = new Map<Texture, number>()
  const surfaces = Array.from({ length: 5 }, (_, i) => ({ ...lit, clearcoat: 1, version: i }))
  for (const surface of surfaces) table.rowWord(surface, layer)
  table.upload(device)
  surfaces[2].clearcoat = 0.5
  surfaces[2].version = 10
  surfaces[3].anisotropy = 0.5
  surfaces[3].version = 11
  table.rowWord(surfaces[2], layer)
  table.rowWord(surfaces[3], layer)
  table.upload(device)
  const sent = texelWrites.at(-1)!
  assert.deepEqual(
    [sent.destination.origin, sent.size],
    [
      [6, 0],
      [6, 1],
    ],
  )
  const floats = new Float32Array(sent.data.buffer, sent.layout.offset)
  assert.deepEqual([floats[2], floats[recordWords(sent)]], [0.5, 0.5])
})

test('the rank of a surface the collector took goes to the next lobed surface', async (t) => {
  const collect = gcOf()
  if (!collect) return t.skip('no collector to call')
  const table = createPhysicalTable()
  const layer = new Map<Texture, number>()
  assert.equal(table.rowWord({ ...lit, clearcoat: 1 }, layer), 1)
  const kept = { ...lit, clearcoat: 1 }
  assert.equal(table.rowWord(kept, layer), 2)
  for (let round = 0; round < 10; round++) {
    collect()
    await new Promise((settled) => setTimeout(settled, 0))
    const next = { ...lit, anisotropy: 1 }
    const word = table.rowWord(next, layer)
    if (word === 1) return
    assert.equal(word, 3 + round)
  }
  assert.fail('the first surface was never collected')
})
