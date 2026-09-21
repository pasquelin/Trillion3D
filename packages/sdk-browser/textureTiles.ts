import { previewFirstLevel, previewLastLevel, previewLevelSize } from '../sdk-core/index.ts';

/**
 * Virtual-texture tile geometry: what the physical pool, the page table and the shader
 * share, written once. Everything is fixed — that is what makes memory independent of the
 * scene: a tile always has the same size, a pool always the same tile count per layer, and
 * only the layer count follows the host budget.
 *
 * A tile carries 128×128 useful texels and a 4-texel gutter on each side, copied from
 * neighbours of the same level: linear filtering at a tile edge thus reads neighbouring
 * texels, not those of the next tile in the pool. A pool layer stores 30×30 tiles; what
 * remains of 4096 is unused. Every measure is a multiple of four: a block-compressed pool
 * (`textureBlockFormats.ts`) copies whole 4×4 blocks, and its tiles land on block boundaries.
 *
 * A texture's levels split in two: STREAMED levels, from 0 through the last that exceeds
 * 64 texels, cut into resident tiles on demand; and the TAIL, from the first level whose
 * both sides fit under 64 texels down to 1×1, stored whole in a single tile, pinned from
 * prepare. A missing streamed tile therefore always shows at least the tail — the same
 * pyramid the sidecar already carries in the manifest.
 */
export const TILE_SIZE = 128;
export const TILE_BORDER = 4;
export const TILE_PITCH = TILE_SIZE + 2 * TILE_BORDER;
const TILES_PER_ROW = 30;
export const POOL_LAYER_SIDE = TILES_PER_ROW * TILE_PITCH;
export const TILES_PER_LAYER = TILES_PER_ROW * TILES_PER_ROW;
/** Bytes of a tile and of a layer, for a pool whose texel costs `texelBytes` — four in RGBA8,
 *  one in a block format: memory follows the format, the tile geometry does not. */
export const tileBytes = (texelBytes: number) => TILE_PITCH * TILE_PITCH * texelBytes;
export const poolLayerBytes = (texelBytes: number) =>
  POOL_LAYER_SIDE * POOL_LAYER_SIDE * texelBytes;
/** Most levels a texture may have: 2^15 texels a side, the device limit. */
export const MAX_LEVELS = 16;

/** Dimensions of a texture's `level`, never less than one texel per side. */
export const levelSize = previewLevelSize;

/** Tiles of a streamed level, columns then rows. */
export function tilesAt(width: number, height: number, level: number): [number, number] {
  const [w, h] = levelSize(width, height, level);
  return [Math.ceil(w / TILE_SIZE), Math.ceil(h / TILE_SIZE)];
}

/**
 * Where a tail level starts in its tile, by rank from the first: 0, then 64, 96, 112, 120, 124,
 * 128. Each level sits to the right of the previous, on a multiple of four so a block-compressed
 * level lands on a block boundary; the 1×1 level therefore starts at 128, and its padded block
 * ends at 132, inside the gutter. The shader (`webgpuTileWgsl.ts`) applies the same rule.
 */
export const tailOffset = (rank: number) => (TILE_SIZE - (TILE_SIZE >> rank) + 3) & ~3;

/** Layout of a texture: its streamed levels, their table entries, and its tail. */
export type TileLayout = {
  width: number;
  height: number;
  /** First tail level; streamed levels are `0 … tail - 1`. */
  tail: number;
  last: number;
  /** First table entry of each streamed level in the texture table. */
  offsets: number[];
  /** Texture table entries: one per tile of each streamed level. */
  entries: number;
};

export function tileLayout(width: number, height: number): TileLayout {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_TEXTURE_SIZE');
  // The tail starts at the level whose both sides fit under 64 texels, and ends at one texel.
  const tail = previewFirstLevel(width, height),
    last = previewLastLevel(width, height);
  if (last >= MAX_LEVELS) throw new Error('TEXTURE_TOO_LARGE');
  const offsets: number[] = [];
  let entries = 0;
  for (let level = 0; level < tail; level++) {
    offsets.push(entries);
    const [tw, th] = tilesAt(width, height, level);
    entries += tw * th;
  }
  return { width, height, tail, last, offsets, entries };
}

/** A pool slot: tile column, row and layer. */
export type TilePlace = { x: number; y: number; layer: number };

/** Rank of a slot in the pool, and the inverse. */
export const placeIndex = (p: TilePlace) => p.layer * TILES_PER_LAYER + p.y * TILES_PER_ROW + p.x;
export function placeOf(index: number): TilePlace {
  const layer = Math.floor(index / TILES_PER_LAYER),
    rest = index - layer * TILES_PER_LAYER;
  return { x: rest % TILES_PER_ROW, y: Math.floor(rest / TILES_PER_ROW), layer };
}

/**
 * Word of a table entry: the resident tile's place and the level it carries, which
 * may be coarser than the entry's when the requested tile is still missing. The high bit
 * says the entry is served; zero says "nothing streamed here, read the tail".
 */
const ENTRY_SERVED = 0x80000000;
export const packEntry = (place: TilePlace, level: number) =>
  (ENTRY_SERVED | place.x | (place.y << 8) | (place.layer << 16) | (level << 24)) >>> 0;
export const entryLevel = (word: number) => (word >>> 24) & 0x7f;
export const entryPlace = (word: number): TilePlace => ({
  x: word & 0xff,
  y: (word >>> 8) & 0xff,
  layer: (word >>> 16) & 0xff,
});
