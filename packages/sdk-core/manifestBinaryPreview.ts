import { EngineError, type TexturePreview } from './contracts.ts';
import * as format from './manifestBinaryFormat.ts';
import { writeSha } from './manifestBinaryLayout.ts';
import {
  previewFirstLevel,
  previewLevelCount,
  previewLevelSize,
  previewPixelBytes,
} from './texturePreviewLevels.ts';

type PreviewColumns = {
  count: number;
  previewWords: Uint32Array;
  previewShaText: string;
  previewPixels: Uint8Array<ArrayBuffer>;
};

/** Ce qu'une entrée doit annoncer pour ses dimensions source, recalculé et jamais cru sur parole. */
function expectedGeometry(width: number, height: number) {
  return {
    firstLevel: previewFirstLevel(width, height),
    levelCount: previewLevelCount(width, height),
    pixelBytes: previewPixelBytes(width, height),
  };
}

/** Ce que l'écriture et la lecture exigent toutes deux d'une entrée — index de texture entier et
 *  strictement croissant, dimensions source réelles — pour qu'une entrée refusée à l'écriture soit
 *  exactement celle que la lecture refuserait. Rend le `previous` de l'entrée suivante. */
function checkEntryHeader(
  entry: number,
  texture: number,
  width: number,
  height: number,
  previous: number,
) {
  if (!Number.isInteger(texture) || texture <= previous)
    throw new EngineError('INVALID_CACHE', 'Texture previews are not ordered by texture index', {
      entry,
      texture,
    });
  if (!(width > 0) || !(height > 0))
    throw new EngineError('INVALID_CACHE', 'A texture preview declares an empty source image', {
      entry,
      width,
      height,
    });
  return texture;
}

/**
 * Rebuilds the progressive level entries, checking every one before a byte of it is handed on: the
 * texture indices must climb, the source dimensions must be real, the declared level geometry must
 * be the one those dimensions imply, and the byte ranges must follow one another without a gap or
 * an overlap — so one entry can never be read as another's.
 */
export function decodeTexturePreviews(columns: PreviewColumns): TexturePreview[] {
  const { count, previewWords, previewShaText, previewPixels } = columns;
  const previews: TexturePreview[] = new Array(count);
  let previous = -1,
    consumed = 0;
  for (let entry = 0; entry < count; entry++) {
    const base = entry * format.PREVIEW_WORDS;
    const texture = previewWords[base + format.PREVIEW_TEXTURE];
    const width = previewWords[base + format.PREVIEW_WIDTH],
      height = previewWords[base + format.PREVIEW_HEIGHT];
    previous = checkEntryHeader(entry, texture, width, height, previous);
    const expected = expectedGeometry(width, height);
    const firstLevel = previewWords[base + format.PREVIEW_FIRST_LEVEL];
    const declared = {
      firstLevel,
      levelCount: previewWords[base + format.PREVIEW_LEVEL_COUNT],
      pixelBytes: previewWords[base + format.PREVIEW_PIXEL_BYTES],
    };
    const offset = previewWords[base + format.PREVIEW_PIXEL_OFFSET];
    if (
      declared.firstLevel !== expected.firstLevel ||
      declared.levelCount !== expected.levelCount ||
      declared.pixelBytes !== expected.pixelBytes
    )
      throw new EngineError(
        'INVALID_CACHE',
        'A texture preview level geometry is not the one its dimensions imply',
        { entry, width, height, declared, expected },
      );
    if (offset !== consumed || offset + declared.pixelBytes > previewPixels.length)
      throw new EngineError('INVALID_CACHE', 'A texture preview pixel range is not contiguous', {
        entry,
        offset,
        expected: consumed,
        bytes: declared.pixelBytes,
        column: previewPixels.length,
      });
    const levels: Uint8Array<ArrayBuffer>[] = [];
    let at = offset;
    for (let index = 0; index < declared.levelCount; index++) {
      const [w, h] = previewLevelSize(width, height, firstLevel + index);
      levels.push(previewPixels.subarray(at, at + w * h * 4));
      at += w * h * 4;
    }
    consumed = at;
    const sourceKind = previewWords[base + format.PREVIEW_SOURCE_KIND];
    previews[entry] = {
      texture,
      image: previewWords[base + format.PREVIEW_IMAGE],
      width,
      height,
      sourceKind,
      sourceBufferView:
        sourceKind === format.PREVIEW_SOURCE_URI
          ? -1
          : previewWords[base + format.PREVIEW_SOURCE_VIEW],
      sha256: previewShaText.substring(entry * 64, entry * 64 + 64),
      firstLevel,
      levels,
    };
  }
  return previews;
}

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
  let previous = -1,
    offset = 0;
  previews.forEach((preview, entry) => {
    previous = checkEntryHeader(entry, preview.texture, preview.width, preview.height, previous);
    const expected = expectedGeometry(preview.width, preview.height);
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
    writeSha(sha, entry, preview.sha256);
    for (let index = 0; index < expected.levelCount; index++) {
      const [w, h] = previewLevelSize(preview.width, preview.height, expected.firstLevel + index);
      const source = preview.levels[index];
      if (!source || source.length !== w * h * 4)
        throw new EngineError('INVALID_CACHE', 'A texture preview level has the wrong length', {
          entry,
          level: expected.firstLevel + index,
          length: source?.length ?? null,
          expected: w * h * 4,
        });
      pixels.set(source, offset);
      offset += source.length;
    }
  });
}
