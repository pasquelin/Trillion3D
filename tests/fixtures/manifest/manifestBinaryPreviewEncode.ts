import { EngineError } from '../../../packages/sdk-core/src/contracts/cache.ts'
import type { TexturePreview } from '../../../packages/sdk-core/src/texture/previewContracts.ts'
import * as format from '../../../packages/sdk-core/src/manifest/binaryFormat.ts'
import {
  PREVIEW_WORDS,
  PREVIEW_TEXTURE,
  PREVIEW_IMAGE,
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PREVIEW_SOURCE_KIND,
  PREVIEW_SOURCE_VIEW,
  PREVIEW_SOURCE_URI,
  PREVIEW_FIRST_LEVEL,
  PREVIEW_LEVEL_COUNT,
  PREVIEW_PIXEL_OFFSET,
  PREVIEW_PIXEL_BYTES,
  PREVIEW_ATLAS,
  PREVIEW_BAKED_LEVELS,
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_LAYOUTS,
  PREVIEW_LAYOUT_NAMES,
} from '../../../packages/sdk-core/src/texture/previewFormat.ts'
import { writeSha } from './manifestBinaryEncodeChecks.ts'
import {
  checkEntryHeader,
  levelLengths,
} from '../../../packages/sdk-core/src/manifest/binaryPreviewEntry.ts'
import { previewGeometry } from '../../../packages/sdk-core/src/texture/previewLevels.ts'

type ColumnView = <T>(
  name: format.ColumnName,
  make: (buffer: ArrayBuffer, offset: number, elements: number) => T,
) => T

/**
 * Writes the three preview columns of an encoder that hands out views by column name, refusing
 * anything the reader above would refuse.
 */
export function encodePreviewColumns(previews: readonly TexturePreview[], view: ColumnView) {
  const bytes = (name: format.ColumnName) => view(name, (b, o, n) => new Uint8Array(b, o, n))
  const words = view('texturePreviewU32', (b, o, n) => new Uint32Array(b, o, n))
  const sha = bytes('texturePreviewSha')
  const pixels = bytes('texturePreviewPixels')
  const columns = {
    bc7: bytes('texturePreviewBc7'),
    astc: bytes('texturePreviewAstc'),
    etc2: bytes('texturePreviewEtc2'),
  }
  const blocksAt = { bc7: 0, astc: 0, etc2: 0 }
  let previous = -1,
    offset = 0
  previews.forEach((preview, entry) => {
    const expected = previewGeometry(preview.width, preview.height)
    previous = checkEntryHeader(entry, preview, previous, expected.firstLevel)
    const base = entry * PREVIEW_WORDS
    words[base + PREVIEW_TEXTURE] = preview.texture
    words[base + PREVIEW_IMAGE] = preview.image
    words[base + PREVIEW_WIDTH] = preview.width
    words[base + PREVIEW_HEIGHT] = preview.height
    words[base + PREVIEW_SOURCE_KIND] = preview.sourceKind
    words[base + PREVIEW_SOURCE_VIEW] =
      preview.sourceKind === PREVIEW_SOURCE_URI ? 0xffffffff : preview.sourceBufferView
    words[base + PREVIEW_FIRST_LEVEL] = expected.firstLevel
    words[base + PREVIEW_LEVEL_COUNT] = expected.levelCount
    words[base + PREVIEW_PIXEL_OFFSET] = offset
    words[base + PREVIEW_PIXEL_BYTES] = expected.pixelBytes
    words[base + PREVIEW_ATLAS] = preview.atlas
    words[base + PREVIEW_BAKED_LEVELS] = preview.bakedLevels
    PREVIEW_BLOCK_FORMATS.forEach((name, family) => {
      words[base + PREVIEW_LAYOUTS + family] = PREVIEW_LAYOUT_NAMES.indexOf(preview.layouts[name])
    })
    writeSha(sha, entry, preview.sha256)
    const check = (source: Uint8Array | undefined, length: number, index: number, kind: string) => {
      if (!source || source.length !== length)
        throw new EngineError('INVALID_CACHE', 'A texture preview level has the wrong length', {
          entry,
          level: expected.firstLevel + index,
          kind,
          length: source?.length ?? null,
          expected: length,
        })
      return source
    }
    const lengths = levelLengths(expected)
    lengths.rgba.forEach((length, index) => {
      pixels.set(check(preview.levels[index], length, index, 'rgba8'), offset)
      offset += length
    })
    for (const name of PREVIEW_BLOCK_FORMATS) {
      if (preview.layouts[name] === 'lossless') {
        if (preview.blocks[name].length !== 0)
          throw new EngineError('INVALID_CACHE', 'A lossless texture preview carries blocks', {
            entry,
            format: name,
          })
        continue
      }
      lengths.blocks.forEach((length, index) => {
        columns[name].set(check(preview.blocks[name][index], length, index, name), blocksAt[name])
        blocksAt[name] += length
      })
    }
  })
}
