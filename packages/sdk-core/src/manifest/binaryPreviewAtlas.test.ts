// The atlas and baked-level words of a preview entry: they round-trip, entries sort by texture then
// atlas — a coverage chain as its texture's colour entry —, and words out of range are refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { preview } from '../../../../tests/fixtures/manifest/manifestBinaryPreview.ts'
import { decodeManifestBinary } from './binaryDecode.ts'
import {
  PREVIEW_ATLAS,
  PREVIEW_BAKED_LEVELS,
  encode,
  previewWord,
  refused,
} from '../../../../tests/fixtures/manifest/manifestBinaryPreviewSidecar.ts'

test('atlas and baked levels round-trip, and the same texture may serve both atlases in order', () => {
  const color = { ...preview(3, 256, 128, 1), atlas: 0, bakedLevels: 2 }
  const data = { ...preview(3, 256, 128, 2), atlas: 1, bakedLevels: 2 }
  const { slim, buffer } = encode([preview(1, 8, 8, 0), color, data])
  const decoded = decodeManifestBinary(slim, buffer).texturePreviews!
  assert.equal(decoded.length, 3)
  assert.deepEqual(
    decoded.map((p) => [p.texture, p.atlas, p.bakedLevels]),
    [
      [1, 0, 0],
      [3, 0, 2],
      [3, 1, 2],
    ],
  )
  assert.equal(previewWord(buffer, 1, PREVIEW_ATLAS)[0], 0)
  assert.equal(previewWord(buffer, 2, PREVIEW_ATLAS)[0], 1)
  assert.equal(previewWord(buffer, 2, PREVIEW_BAKED_LEVELS)[0], 2)
})

test('the same texture twice for one atlas, or data before colour, is refused as unordered', () => {
  const twice = [preview(3, 8, 8, 1), preview(3, 8, 8, 2)]
  assert.throws(() => encode(twice), /not ordered by texture and atlas/)
  const backwards = [{ ...preview(3, 8, 8, 1), atlas: 1 }, preview(3, 8, 8, 2)]
  assert.throws(() => encode(backwards), /not ordered by texture and atlas/)
})

// A coverage chain (word 2) is its texture's colour-atlas entry: it sorts where the plain
// colour one would, before the data entry, and one texture never carries both colour chains —
// the reader would have to pick one, and an emissive reader would draw the weighted one.
test('a coverage chain sorts as the colour entry of its texture, and never beside a plain one', () => {
  const coverage = { ...preview(3, 8, 8, 1), atlas: 2 }
  const data = { ...preview(3, 8, 8, 2), atlas: 1 }
  const { slim, buffer } = encode([coverage, data, preview(4, 8, 8, 3)])
  const decoded = decodeManifestBinary(slim, buffer).texturePreviews!
  assert.deepEqual(
    decoded.map((p) => [p.texture, p.atlas]),
    [
      [3, 2],
      [3, 1],
      [4, 0],
    ],
  )
  assert.throws(() => encode([data, coverage]), /not ordered by texture and atlas/)
  assert.throws(() => encode([preview(3, 8, 8, 1), coverage]), /not ordered by texture and atlas/)
})

test('an unknown atlas, or more baked levels than lie above the tail, is refused by both sides', () => {
  assert.throws(() => encode([{ ...preview(0, 8, 8, 1), atlas: 3 }]), /unknown atlas/)
  assert.throws(
    () => encode([{ ...preview(0, 256, 256, 1), bakedLevels: 3 }]),
    /more levels than lie above its tail/,
  )
  // A sidecar whose word was forced after the fact is rejected on read, not only on write.
  const { slim, buffer } = encode([preview(0, 256, 256, 1)])
  previewWord(buffer, 0, PREVIEW_ATLAS)[0] = 7
  refused(buffer, slim)
})
