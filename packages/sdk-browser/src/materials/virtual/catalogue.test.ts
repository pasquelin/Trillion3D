import test from 'node:test'
import assert from 'node:assert/strict'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import {
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_ATLAS_HDR,
} from '../../../../sdk-core/src/texture/previewFormat.ts'
import type { TexturePreview } from '../../../../sdk-core/src/texture/previewContracts.ts'

import { hdrPreview } from '../../../../../tests/fixtures/manifest/manifestBinaryPreview.ts'
import { previewLevels } from '../../../../../tests/fixtures/manifest/manifestBinaryLevels.ts'
import { tileCatalogue } from './catalogue.ts'
import { createTextureCaches } from '../texture/textureCaches.ts'
import { poolEncoding } from '../texture/blockFormats.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

const preview = (width: number, height: number, bakedLevels: number): TexturePreview => ({
  texture: 0,
  image: 0,
  width,
  height,
  sourceKind: 0,
  sourceBufferView: -1,
  sha256: 'a'.repeat(64),
  atlas: 0,
  firstLevel: bakedLevels,
  bakedLevels,
  ...previewLevels(width, height, 3),
})
const map = () => {
  const texture = new Texture()
  texture.image = { data: new Uint8Array(4 * 4 * 4), width: 4, height: 4 }
  return texture
}
const reader = Object.assign(
  async () => {
    throw new Error('never read here')
  },
  { store: createPageCache(), key: 'k' },
)
/** `preview` found in a cache read by `reader`. */
const baked = (preview: TexturePreview) => () => ({ preview, read: reader })

// Behaviour: a tail carries every encoding the sidecar holds, the fill slot the white texel in
// each, and every texture takes the lane of its chain's layout in the session's family — the
// lossless one where the gate refused it, without a family, or hosted for want of a whole
// chain; the fill sits in the family's RGBA lane when a chain is kept there, else in any lane
// the textures already open.
const SIZE = { width: 4, height: 4, tail: 0 }

test('a catalogue routes each texture to the lane of its layout and hosts what has no chain', () => {
  const chain = preview(256, 128, 2)
  const bc7 = poolEncoding('bc7')
  const [fill, entry, hosted] = tileCatalogue(
    [map(), map()],
    (i) => (i === 0 ? { preview: chain, read: reader } : undefined),
    bc7,
  )
  assert.deepEqual(fill, {
    layout: fill.layout,
    lane: 'rgba',
    tap: 1,
    source: { kind: 'bytes', tail: bc7.whiteOf('rgba') },
  })
  assert.equal(entry.source.kind, 'baked')
  assert.equal(entry.lane, 'rgba')
  if (entry.source.kind === 'baked') assert.equal(entry.source.tail, chain)
  assert.deepEqual([hosted.source.kind, hosted.lane], ['host', 'lossless'])
  const [astcFill, astc] = tileCatalogue([map()], baked(chain), poolEncoding('astc'))
  assert.equal(astc.lane, 'two-channel')
  assert.equal(astcFill.lane, 'two-channel', 'the fill opens no RGBA layer of its own')
  const refused = { ...chain, layouts: { bc7: 'lossless', astc: 'rgba', etc2: 'rgba' } as const }
  const [, lossless] = tileCatalogue([map()], baked(refused), bc7)
  assert.equal(lossless.lane, 'lossless')
  const [hostFill, host] = tileCatalogue([map()], () => undefined, bc7)
  assert.deepEqual(
    [hostFill.lane, host.lane],
    ['lossless', 'lossless'],
    'a host-only scene opens no block layer for the fill alone',
  )
  const raw = poolEncoding(undefined)
  const [rawFill, small] = tileCatalogue([map()], baked(preview(32, 32, 0)), raw)
  assert.deepEqual([rawFill.lane, small.source.kind, small.lane], ['lossless', 'bytes', 'lossless'])
})

// A half-float chain (word 2) is the colour atlas's entry of its texture, found where the 8-bit
// one would be, and keeps its word — the one its level files are named by. Whatever the session's
// family, it takes the half-float lane, its texels as they are: eight bytes a texel, its files
// `rgba16f`, no sRGB decode.
test('a half-float chain is filed as the colour entry of its texture and takes the half-float lane', () => {
  const hdr = { ...hdrPreview(3, 256, 128, 2), bakedLevels: 2 }
  const data = { ...preview(256, 128, 2), texture: 3, atlas: PREVIEW_ATLAS_DATA }
  const texture = map()
  const caches = createTextureCaches(createPageCache())
  caches.add({
    ranks: new Map([[texture, 3]]),
    metadata: { key: 'k', texturePreviews: [hdr, data] },
    base: '',
  })
  const previewAt = (atlas: number) => caches.chainOf(texture, atlas)?.preview
  assert.equal(previewAt(PREVIEW_ATLAS_COLOR), hdr)
  assert.equal(previewAt(PREVIEW_ATLAS_DATA), data)
  assert.equal(previewAt(PREVIEW_ATLAS_HDR), undefined, 'filed by atlas, not by word')
  for (const block of ['bc7', undefined] as const) {
    const encoding = poolEncoding(block)
    const [, entry] = tileCatalogue([map()], baked(hdr), encoding)
    assert.equal(entry.lane, 'hdr')
    assert.equal(entry.source.kind === 'baked' && entry.source.atlas, PREVIEW_ATLAS_HDR)
    assert.equal(encoding.formatOf('color', 'hdr'), 'rgba16float')
    assert.equal(encoding.texelBytes('hdr'), 8)
    assert.equal(encoding.levelFormat('hdr', hdr), 'rgba16f')
    assert.equal(encoding.tapOf('hdr'), 4)
    assert.equal(encoding.tailOf(hdr, 'hdr', SIZE), hdr.levels)
  }
})
