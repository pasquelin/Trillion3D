import { EngineError, type TexturePreview } from '../contracts/index.ts';
import * as format from './binaryFormat.ts';
import { levelBlockBytes, previewGeometry } from '../texture/previewLevels.ts';

type PreviewColumns = {
  count: number;
  previewWords: Uint32Array;
  previewShaText: string;
  previewPixels: Uint8Array<ArrayBuffer>;
  /** The block-compressed tails, one column per format, entries contiguous in order. */
  previewBlocks: Record<format.TextureBlockFormat, Uint8Array<ArrayBuffer>>;
};

/** Byte length of each carried level in the pixel column and in a block column, tail order. */
export function levelLengths(geometry: ReturnType<typeof previewGeometry>) {
  return {
    rgba: geometry.sizes.map(([w, h]) => w * h * 4),
    blocks: geometry.sizes.map(([w, h]) => levelBlockBytes(w, h)),
  };
}

/** The layout a family's word names, or a refusal of a word no layout owns. */
function layoutOf(entry: number, name: format.TextureBlockFormat, word: number) {
  const layout = format.PREVIEW_LAYOUT_NAMES[word];
  if (layout === undefined)
    throw new EngineError('INVALID_CACHE', 'A texture preview names an unknown block layout', {
      entry,
      format: name,
      word,
    });
  return layout;
}

/** Consecutive views of `lengths` bytes out of `column` from `at`, and where they end. */
function slices(column: Uint8Array<ArrayBuffer>, at: number, lengths: readonly number[]) {
  const views = lengths.map((length) => {
    const view = column.subarray(at, at + length);
    at += length;
    return view;
  });
  return { views, end: at };
}

/** What both write and read require of an entry — integer (texture, atlas) pair
 *  strictly increasing, known atlas, real source dimensions, baked levels under the tail —
 *  so an entry rejected on write is exactly the one read would reject. Returns the
 *  entry key, which the next one must exceed. */
export function checkEntryHeader(
  entry: number,
  header: Pick<TexturePreview, 'texture' | 'atlas' | 'width' | 'height' | 'bakedLevels'>,
  previous: number,
  firstLevel: number,
) {
  const { texture, atlas, width, height, bakedLevels } = header;
  const chains = format.PREVIEW_ATLAS_NAMES.length;
  if (!Number.isInteger(atlas) || atlas < 0 || atlas >= chains)
    throw new EngineError('INVALID_CACHE', 'A texture preview names an unknown atlas', {
      entry,
      atlas,
    });
  const key = texture * chains + atlas;
  if (!Number.isInteger(texture) || key <= previous)
    throw new EngineError(
      'INVALID_CACHE',
      'Texture previews are not ordered by texture and atlas',
      {
        entry,
        texture,
        atlas,
      },
    );
  if (!(width > 0) || !(height > 0))
    throw new EngineError('INVALID_CACHE', 'A texture preview declares an empty source image', {
      entry,
      width,
      height,
    });
  if (!Number.isInteger(bakedLevels) || bakedLevels < 0 || bakedLevels > firstLevel)
    throw new EngineError(
      'INVALID_CACHE',
      'A texture preview bakes more levels than lie above its tail',
      {
        entry,
        bakedLevels,
      },
    );
  return key;
}

/**
 * Rebuilds the progressive level entries, checking every one before a byte of it is handed on: the
 * texture indices must climb, the source dimensions must be real, the declared level geometry must
 * be the one those dimensions imply, and the byte ranges must follow one another without a gap or
 * an overlap — so one entry can never be read as another's. The block columns write no range:
 * each kept entry's follows the previous one's at the length its dimensions imply, a lossless
 * entry has none, and a column that ends before or after the last entry is refused whole.
 */
export function decodeTexturePreviews(columns: PreviewColumns): TexturePreview[] {
  const { count, previewWords, previewShaText, previewPixels, previewBlocks } = columns;
  const previews: TexturePreview[] = new Array(count);
  let previous = -1,
    consumed = 0;
  const blocksAt = { bc7: 0, astc: 0 } as Record<format.TextureBlockFormat, number>;
  for (let entry = 0; entry < count; entry++) {
    const base = entry * format.PREVIEW_WORDS;
    const texture = previewWords[base + format.PREVIEW_TEXTURE];
    const width = previewWords[base + format.PREVIEW_WIDTH],
      height = previewWords[base + format.PREVIEW_HEIGHT];
    const atlas = previewWords[base + format.PREVIEW_ATLAS],
      bakedLevels = previewWords[base + format.PREVIEW_BAKED_LEVELS];
    const expected = previewGeometry(width, height);
    const header = { texture, atlas, width, height, bakedLevels };
    previous = checkEntryHeader(entry, header, previous, expected.firstLevel);
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
    const lengths = levelLengths(expected);
    const pixels = slices(previewPixels, offset, lengths.rgba);
    consumed = pixels.end;
    const layouts = {} as TexturePreview['layouts'],
      blocks = {} as TexturePreview['blocks'];
    format.PREVIEW_BLOCK_FORMATS.forEach((name, family) => {
      layouts[name] = layoutOf(entry, name, previewWords[base + format.PREVIEW_LAYOUTS + family]);
      if (layouts[name] === 'lossless') {
        blocks[name] = [];
        return;
      }
      const column = previewBlocks[name];
      if (blocksAt[name] + expected.blockBytes > column.length)
        throw new EngineError('INVALID_CACHE', 'A texture preview block column is too short', {
          entry,
          format: name,
          column: column.length,
        });
      const sliced = slices(column, blocksAt[name], lengths.blocks);
      blocks[name] = sliced.views;
      blocksAt[name] = sliced.end;
    });
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
      atlas,
      firstLevel,
      bakedLevels,
      levels: pixels.views,
      layouts,
      blocks,
    };
  }
  for (const name of format.PREVIEW_BLOCK_FORMATS)
    if (blocksAt[name] !== previewBlocks[name].length)
      throw new EngineError('INVALID_CACHE', 'A texture preview block column is too long', {
        format: name,
        column: previewBlocks[name].length,
        expected: blocksAt[name],
      });
  return previews;
}
