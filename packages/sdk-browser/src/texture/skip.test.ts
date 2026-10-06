import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest, TexturePreview } from '../../../sdk-core/src/index.ts'
import { bakedImages } from './skip.ts'

const entry = (image: number, firstLevel: number, bakedLevels: number): TexturePreview => ({
  texture: image,
  image,
  width: 256,
  height: 256,
  sourceKind: 0,
  sourceBufferView: -1,
  sha256: '0'.repeat(64),
  atlas: 0,
  firstLevel,
  bakedLevels,
  levels: [],
  layouts: { bc7: 'lossless', astc: 'lossless' },
  blocks: { bc7: [], astc: [] },
})
const manifest = (previews: TexturePreview[]): ClusterManifest =>
  ({ textures: { url: 'x' }, texturePreviews: previews }) as unknown as ClusterManifest

// Behaviour: an image is skipped only if every entry that reads it is whole; with no entry it is
// read as before. Where it lives — an address, `data:` or a view of the binary — is not asked.
test('an image is skipped only if all of its entries are whole', () => {
  const ranks = bakedImages(manifest([entry(0, 2, 2), entry(0, 2, 0), entry(1, 2, 2)]), 3)
  assert.deepEqual([...ranks], [1])
})

// Behaviour: an entry naming an image the document does not hold spares nothing.
test('an entry past the last image is no skipped image', () => {
  assert.deepEqual([...bakedImages(manifest([entry(0, 2, 2), entry(4, 2, 2)]), 2)], [0])
})
