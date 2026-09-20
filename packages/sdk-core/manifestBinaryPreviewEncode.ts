import { EngineError, type TexturePreview } from './contracts.ts';
import * as format from './manifestBinaryFormat.ts';
import { writeSha } from './manifestBinaryLayout.ts';
import { checkEntryHeader, levelLengths, rgbaBytes } from './manifestBinaryPreview.ts';
import { levelBlockBytes, previewGeometry } from './texturePreviewLevels.ts';

type ColumnView = <T>(
  name: format.ColumnName,
  make: (buffer: ArrayBuffer, offset: number, elements: number) => T,
) => T;

/**
 * Writes the three preview columns of an encoder that hands out views by column name, refusing
 * anything the reader above would refuse.
 */
export function encodePreviewColumns(previews: readonly TexturePreview[], view: ColumnView) {
  const words = view('texturePreviewU32', (b, o, n) => new Uint32Array(b, o, n));
  const sha = view('texturePreviewSha', (b, o, n) => new Uint8Array(b, o, n));
  const pixels = view('texturePreviewPixels', (b, o, n) => new Uint8Array(b, o, n));
  const columns = {
    bc7: view('texturePreviewBc7', (b, o, n) => new Uint8Array(b, o, n)),
    astc: view('texturePreviewAstc', (b, o, n) => new Uint8Array(b, o, n)),
  };
  const blocksAt = { bc7: 0, astc: 0 };
  let previous = -1,
    offset = 0;
  previews.forEach((preview, entry) => {
    previous = checkEntryHeader(entry, preview, previous);
    const expected = previewGeometry(preview.width, preview.height);
    const base = entry * format.PREVIEW_WORDS;
    words[base + format.PREVIEW_TEXTURE] = preview.texture;
    words[base + format.PREVIEW_IMAGE] = preview.image;
    words[base + format.PREVIEW_WIDTH] = preview.width;
    words[base + format.PREVIEW_HEIGHT] = preview.height;
    words[base + format.PREVIEW_SOURCE_KIND] = preview.sourceKind;
    words[base + format.PREVIEW_SOURCE_VIEW] =
      preview.sourceKind === format.PREVIEW_SOURCE_URI ? 0xffffffff : preview.sourceBufferView;
    words[base + format.PREVIEW_FIRST_LEVEL] = expected.firstLevel;
    words[base + format.PREVIEW_LEVEL_COUNT] = expected.levelCount;
    words[base + format.PREVIEW_PIXEL_OFFSET] = offset;
    words[base + format.PREVIEW_PIXEL_BYTES] = expected.pixelBytes;
    words[base + format.PREVIEW_ATLAS] = preview.atlas;
    words[base + format.PREVIEW_BAKED_LEVELS] = preview.bakedLevels;
    writeSha(sha, entry, preview.sha256);
    const check = (source: Uint8Array | undefined, length: number, index: number, kind: string) => {
      if (!source || source.length !== length)
        throw new EngineError('INVALID_CACHE', 'A texture preview level has the wrong length', {
          entry,
          level: expected.firstLevel + index,
          kind,
          length: source?.length ?? null,
          expected: length,
        });
      return source;
    };
    levelLengths(preview.width, preview.height, rgbaBytes).forEach((length, index) => {
      pixels.set(check(preview.levels[index], length, index, 'rgba8'), offset);
      offset += length;
    });
    for (const name of format.PREVIEW_BLOCK_FORMATS)
      levelLengths(preview.width, preview.height, levelBlockBytes).forEach((length, index) => {
        columns[name].set(check(preview.blocks[name][index], length, index, name), blocksAt[name]);
        blocksAt[name] += length;
      });
  });
}
