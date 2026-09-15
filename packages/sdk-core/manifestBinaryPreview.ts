import { EngineError, type TexturePreview } from './contracts.ts';
import * as format from './manifestBinaryFormat.ts';
import { writeSha } from './manifestBinaryLayout.ts';

type PreviewColumns = {
  count: number;
  previewWords: Uint32Array;
  previewShaText: string;
  previewPixels: Uint8Array<ArrayBuffer>;
};

/**
 * Rebuilds the texture preview entries, checking every one before a byte of it is handed on: the
 * declared level offsets must be exactly this version's, the source dimensions must be real, and
 * the texture indices must climb, so one entry can never be read as another's.
 */
export function decodeTexturePreviews(columns: PreviewColumns): TexturePreview[] {
  const { count, previewWords, previewShaText, previewPixels } = columns;
  const previews: TexturePreview[] = new Array(count);
  let previous = -1;
  for (let entry = 0; entry < count; entry++) {
    const base = entry * format.PREVIEW_WORDS;
    const texture = previewWords[base + format.PREVIEW_TEXTURE];
    const width = previewWords[base + format.PREVIEW_WIDTH],
      height = previewWords[base + format.PREVIEW_HEIGHT];
    if (texture <= previous)
      throw new EngineError('INVALID_CACHE', 'Texture previews are not ordered by texture index', {
        entry,
        texture,
      });
    previous = texture;
    if (width === 0 || height === 0)
      throw new EngineError('INVALID_CACHE', 'A texture preview declares an empty source image', {
        entry,
        width,
        height,
      });
    const start = entry * format.PREVIEW_BYTES;
    const levels = format.PREVIEW_LEVEL_SIZES.map((size, level) => {
      const offset = previewWords[base + format.PREVIEW_FIRST_OFFSET + level];
      if (offset !== format.PREVIEW_LEVEL_OFFSETS[level])
        throw new EngineError(
          'INVALID_CACHE',
          'A texture preview level offset is not this format',
          {
            entry,
            level,
            offset,
            expected: format.PREVIEW_LEVEL_OFFSETS[level],
          },
        );
      return previewPixels.subarray(start + offset, start + offset + size * size * 4);
    });
    previews[entry] = {
      texture,
      image: previewWords[base + format.PREVIEW_IMAGE],
      width,
      height,
      sourceKind: previewWords[base + format.PREVIEW_SOURCE_KIND],
      sourceBufferView:
        previewWords[base + format.PREVIEW_SOURCE_KIND] === format.PREVIEW_SOURCE_URI
          ? -1
          : previewWords[base + format.PREVIEW_SOURCE_VIEW],
      sha256: previewShaText.substring(entry * 64, entry * 64 + 64),
      levels,
    };
  }
  return previews;
}

type ColumnView = <T>(
  name: format.ColumnName,
  make: (buffer: ArrayBuffer, offset: number, elements: number) => T,
) => T;

/** Writes the three preview columns of an encoder that hands out views by column name. */
export function encodePreviewColumns(previews: readonly TexturePreview[], view: ColumnView) {
  encodeTexturePreviews(
    previews,
    view('texturePreviewU32', (b, o, n) => new Uint32Array(b, o, n)),
    view('texturePreviewSha', (b, o, n) => new Uint8Array(b, o, n)),
    view('texturePreviewPixels', (b, o, n) => new Uint8Array(b, o, n)),
  );
}

/** Writes the same entries back, refusing anything the reader above would refuse. */
function encodeTexturePreviews(
  previews: readonly TexturePreview[],
  words: Uint32Array,
  sha: Uint8Array,
  pixels: Uint8Array,
) {
  let previous = -1;
  previews.forEach((preview, entry) => {
    if (!Number.isInteger(preview.texture) || preview.texture <= previous)
      throw new EngineError('INVALID_CACHE', 'Texture previews are not ordered by texture index', {
        entry,
        texture: preview.texture,
      });
    previous = preview.texture;
    if (!(preview.width > 0) || !(preview.height > 0))
      throw new EngineError('INVALID_CACHE', 'A texture preview declares an empty source image', {
        entry,
        width: preview.width,
        height: preview.height,
      });
    const base = entry * format.PREVIEW_WORDS,
      start = entry * format.PREVIEW_BYTES;
    words[base + format.PREVIEW_TEXTURE] = preview.texture;
    words[base + format.PREVIEW_IMAGE] = preview.image;
    words[base + format.PREVIEW_WIDTH] = preview.width;
    words[base + format.PREVIEW_HEIGHT] = preview.height;
    words[base + format.PREVIEW_SOURCE_KIND] = preview.sourceKind;
    words[base + format.PREVIEW_SOURCE_VIEW] =
      preview.sourceKind === format.PREVIEW_SOURCE_URI ? 0xffffffff : preview.sourceBufferView;
    writeSha(sha, entry, preview.sha256);
    format.PREVIEW_LEVEL_SIZES.forEach((size, level) => {
      const offset = format.PREVIEW_LEVEL_OFFSETS[level];
      words[base + format.PREVIEW_FIRST_OFFSET + level] = offset;
      const source = preview.levels[level];
      if (!source || source.length !== size * size * 4)
        throw new EngineError('INVALID_CACHE', 'A texture preview level has the wrong length', {
          entry,
          level,
          length: source?.length ?? null,
          expected: size * size * 4,
        });
      pixels.set(source, start + offset);
    });
  });
}
