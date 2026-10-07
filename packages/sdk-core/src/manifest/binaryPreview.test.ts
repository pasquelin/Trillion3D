// A preview sidecar is read only as written: an older version, a declared geometry or byte range
// that disagrees with the dimensions, or a block tail column of the wrong length is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { preview } from '../../../../tests/fixtures/manifest/manifestBinaryPreview.ts'
import { decodeManifestBinary } from './binaryDecode.ts'
import { EngineError } from '../contracts/index.ts'
import { previewBlockBytes } from '../texture/previewLevels.ts'
import {
  PREVIEW_FIRST_LEVEL,
  PREVIEW_LAYOUTS,
  PREVIEW_PIXEL_BYTES,
  PREVIEW_PIXEL_OFFSET,
  encode,
  previewWord,
  refused,
} from '../../../../tests/fixtures/manifest/manifestBinaryPreviewSidecar.ts'

// Behaviour 5: a version-4 sidecar round-trips, and its reader rejects a version 3.
test('a version 3 sidecar (the fixed-length preview entries) is refused, never read as version 4', () => {
  const { slim, buffer } = encode([preview(0, 32, 16, 1)])
  const header = new Uint32Array(buffer, 0, 2)
  header[1] = 3
  assert.throws(
    () => decodeManifestBinary(slim, buffer),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  )
})

// Behaviour 5: declared geometry is recomputed from the dimensions, never trusted — a
// first level or pixel length that disagrees with them is rejected.
test('a declared first level that disagrees with the source dimensions is refused', () => {
  const { slim, buffer } = encode([preview(0, 128, 128, 1)])
  previewWord(buffer, 0, PREVIEW_FIRST_LEVEL)[0] += 1
  refused(buffer, slim)
})
test('a declared pixel byte count that disagrees with the source dimensions is refused', () => {
  const { slim, buffer } = encode([preview(0, 128, 128, 1)])
  previewWord(buffer, 0, PREVIEW_PIXEL_BYTES)[0] += 4
  refused(buffer, slim)
})

// Behaviour 5: an entry's byte range must follow the previous one with no gap or
// overlap — an offset that lies in either direction is rejected.
test('a pixel range offset that opens a gap after the previous entry is refused', () => {
  const { slim, buffer } = encode([preview(0, 4, 4, 1), preview(1, 4, 4, 2)])
  previewWord(buffer, 1, PREVIEW_PIXEL_OFFSET)[0] += 8
  refused(buffer, slim)
})
test('a pixel range offset that overlaps the previous entry is refused', () => {
  const { slim, buffer } = encode([preview(0, 4, 4, 1), preview(1, 4, 4, 2)])
  previewWord(buffer, 1, PREVIEW_PIXEL_OFFSET)[0] -= 8
  refused(buffer, slim)
})

// Behaviour: the block tails travel in their own columns with no written range — each kept
// entry's follows the previous at the length its dimensions imply, a lossless entry has none,
// its layout word says so — and a column that is short or long against those lengths is refused
// whole, never sliced wrongly; a lossless entry that carries blocks, or a layout word no layout
// owns, is refused too.
test('block tails round-trip by layout and dimension, and a column of the wrong length is refused', () => {
  const lossless = {
    ...preview(1, 16, 16, 3),
    layouts: { bc7: 'lossless', astc: 'rgba', etc2: 'lossless' } as const,
  }
  lossless.blocks = { bc7: [], astc: lossless.blocks.astc, etc2: [] }
  const previews = [preview(0, 40, 24, 1), lossless, preview(2, 8, 8, 5)]
  const { slim, buffer } = encode(previews)
  assert.equal(
    slim.binary.texturePreviewBc7Bytes,
    previewBlockBytes(40, 24) + previewBlockBytes(8, 8),
  )
  assert.equal(
    slim.binary.texturePreviewAstcBytes,
    previewBlockBytes(40, 24) + previewBlockBytes(16, 16) + previewBlockBytes(8, 8),
  )
  assert.equal(
    slim.binary.texturePreviewEtc2Bytes,
    previewBlockBytes(40, 24) + previewBlockBytes(8, 8),
  )
  const decoded = decodeManifestBinary(slim, buffer).texturePreviews!
  decoded.forEach((entry, index) => {
    assert.deepEqual(entry.layouts, previews[index].layouts)
    assert.deepEqual(entry.blocks, previews[index].blocks)
  })
  for (const delta of [-16, 16]) {
    const lying = { ...slim, binary: { ...slim.binary } }
    lying.binary.texturePreviewBc7Bytes += delta
    refused(buffer, lying)
  }
  previewWord(buffer, 1, PREVIEW_LAYOUTS)[0] = 3
  refused(buffer, slim)
  assert.throws(
    () => encode([{ ...preview(0, 8, 8, 1), blocks: { bc7: [], astc: [], etc2: [] } }]),
    /wrong length/,
  )
  assert.throws(
    () =>
      encode([
        { ...preview(0, 8, 8, 1), layouts: { bc7: 'lossless', astc: 'rgba', etc2: 'rgba' } },
      ]),
    /lossless texture preview carries blocks/,
  )
})
