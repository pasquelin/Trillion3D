// A preview sidecar is read only as written: an older version, a declared geometry or byte range
// that disagrees with the dimensions, or a block tail column of the wrong length is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { preview } from '../../../../tests/fixtures/manifest/manifestBinaryPreview.ts'
import { decodeManifestBinary } from './binaryDecode.ts'
import { fillTexturePreviewLevels } from './binaryPreview.ts'
import { assertManifestBinary, INLINE_PIXELS_VERSION } from './binaryTypes.ts'
import { MANIFEST_BINARY_VERSION } from '../contracts/writtenFormats.ts'
import { EngineError } from '../contracts/cache.ts'
import { previewBlockBytes } from '../texture/previewLevels.ts'
import {
  PREVIEW_FIRST_LEVEL,
  PREVIEW_LAYOUTS,
  PREVIEW_PIXEL_BYTES,
  PREVIEW_PIXEL_OFFSET,
  encode,
  encodeExternal,
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

// Behaviour: a pixel column in its own file leaves the sidecar's empty and the entries counted; once
// the file is filled in, the previews are the ones an inline cache decodes.
test('previews with their pixels in a file of their own equal the inline ones once filled', () => {
  const previews = [preview(0, 40, 24, 1), preview(1, 16, 16, 3), preview(2, 8, 8, 5)]
  const whole = encode(previews)
  const inline = decodeManifestBinary(whole.slim, whole.buffer).texturePreviews!
  const { slim, buffer, pixels } = encodeExternal(previews)
  assert.equal(slim.binary.texturePreviewBytes, 0)
  assert.equal(slim.binary.texturePreviewPixels?.bytes, pixels.length)
  const decoded = decodeManifestBinary(slim, buffer)
  assert.deepEqual(decoded.texturePreviewPixels, slim.binary.texturePreviewPixels)
  const entries = decoded.texturePreviews!
  entries.forEach((entry, index) => {
    assert.equal(entry.levels.length, inline[index].levels.length)
    assert.ok(entry.levels.every((level) => level.length === 0))
    assert.deepEqual(entry.blocks, inline[index].blocks)
  })
  fillTexturePreviewLevels(entries, new Uint8Array(pixels))
  assert.deepEqual(entries, inline)
})
test('a pixel file longer or shorter than its entries imply is refused', () => {
  const { slim, buffer, pixels } = encodeExternal([preview(0, 8, 8, 1), preview(1, 8, 8, 2)])
  const file = slim.binary.texturePreviewPixels!
  for (const bytes of [file.bytes + 4, file.bytes - 4])
    refused(buffer, {
      ...slim,
      binary: { ...slim.binary, texturePreviewPixels: { ...file, bytes } },
    })
  const entries = decodeManifestBinary(slim, buffer).texturePreviews!
  assert.throws(
    () => fillTexturePreviewLevels(entries, new Uint8Array(pixels.subarray(0, pixels.length - 4))),
    /too short/,
  )
})
test('the descriptor of a pixel file is checked before any byte is fetched', () => {
  const { slim } = encodeExternal([preview(0, 8, 8, 1)])
  const file = slim.binary.texturePreviewPixels!
  assertManifestBinary(slim.binary)
  for (const bad of [
    { ...file, bytes: 0 },
    { ...file, sha256: 'xyz' },
    { ...file, url: '' },
  ])
    assert.throws(
      () => assertManifestBinary({ ...slim.binary, texturePreviewPixels: bad }),
      (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
    )
})

test('a version-21 sidecar holding the pixels inline still decodes as it did', () => {
  const previews = [preview(0, 40, 24, 1), preview(1, 16, 16, 3)]
  const { slim, buffer } = encode(previews, INLINE_PIXELS_VERSION)
  assert.equal(slim.binary.version, INLINE_PIXELS_VERSION)
  assert.ok(slim.binary.texturePreviewBytes > 0)
  const decoded = decodeManifestBinary(slim, buffer)
  assert.equal(decoded.texturePreviewPixels, undefined)
  assert.ok(
    decoded.texturePreviews!.every((entry) => entry.levels.every((level) => level.length > 0)),
  )
})
test('a sidecar after version 21 refuses an inline pixel column, and version 21 a pixel file', () => {
  const previews = [preview(0, 8, 8, 1), preview(1, 8, 8, 2)]
  const inline = encode(previews, MANIFEST_BINARY_VERSION)
  assert.ok(inline.slim.binary.texturePreviewBytes > 0)
  refused(inline.buffer, inline.slim)
  const external = encodeExternal(previews, INLINE_PIXELS_VERSION)
  assert.ok(external.slim.binary.texturePreviewPixels)
  refused(external.buffer, external.slim)
  // The current version with no pixel file and an empty column is the sidecar of a cache with no pixel.
  const empty = encodeExternal(previews, MANIFEST_BINARY_VERSION)
  assert.doesNotThrow(() => decodeManifestBinary(empty.slim, empty.buffer))
})
test('a descriptor naming a pixel file beside a filled column is refused', () => {
  const { slim, buffer } = encode([preview(0, 8, 8, 1)], MANIFEST_BINARY_VERSION)
  const file = { url: 'preview-pixels.bin', bytes: 4, sha256: 'a'.repeat(64) }
  refused(buffer, { ...slim, binary: { ...slim.binary, texturePreviewPixels: file } })
})
test('a pixel file of the wrong length leaves every preview without a level written', () => {
  const { slim, buffer, pixels } = encodeExternal([preview(0, 8, 8, 1), preview(1, 8, 8, 2)])
  for (const file of [pixels.subarray(0, pixels.length - 4), new Uint8Array(pixels.length + 4)]) {
    const entries = decodeManifestBinary(slim, buffer).texturePreviews!
    assert.throws(() => fillTexturePreviewLevels(entries, file), /pixel file is too/)
    assert.ok(entries.every((entry) => entry.levels.every((level) => level.length === 0)))
  }
})
