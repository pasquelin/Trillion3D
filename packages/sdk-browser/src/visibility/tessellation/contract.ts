/**
 * The tessellation's numbers, written once for the host that builds its tables and the WGSL that
 * reads them. A triangle is cut by a PATTERN: a triangle of 15-bit fixed-point barycentric
 * vertices and the triangles that join them, one for every triple of edge factors; a patch is a
 * sub-triangle of a source triangle, named by the barycentrics of its three corners.
 */

/** The largest factor an edge of a pattern takes: a triangle with a larger one is split first. */
export const TABLE_SIZE = 14
/** The pattern table's stride: its index is `x + y * 16 + z * 256`, the factors counted from 0. */
export const TABLE_PO2_SIZE = 16
/** The largest factor of the patches a triangle is first cut into: one that needs more than this
 *  is cut by `TABLE_SIZE`-ths, at most this many pieces an edge, and each piece cut again. */
export const SEED_SPLIT_LIMIT = 8
/** The levels a triangle is split in at most. */
export const MAX_SPLIT_LEVELS = 6
/** A barycentric coordinate is a fraction of this, a power of two: 15 bits. */
export const BARYCENTRIC_MAX = 1 << 15
/** Words of a patch: the source triangle's identifier, then its three corners' barycentrics. */
export const PATCH_WORDS = 4
/** The words of a pass's state, in the `tess` buffer, a pass's from its own base: the patches the
 *  queue was asked for (a count past its capacity is the loss), the patches the visible list was
 *  asked for, the level being split, and the slots of the queue that level holds, `start` to
 *  `end`. */
export const ARG_QUEUE = 0,
  ARG_VISIBLE = 1,
  ARG_LEVEL = 2,
  ARG_START = 3,
  ARG_END = 4,
  PASS_ARG_WORDS = 8
/** The dispatches the levels and the dicing are launched with, in a buffer of their own — a buffer
 *  a dispatch reads its size from is bound to no kernel that writes it —: for each pass the
 *  splitting's workgroups (x, y, z), then the dicing's. */
export const DISPATCH_SPLIT = 0,
  DISPATCH_DICE = 3,
  PASS_DISPATCH_WORDS = 8
/** The patches a group of the dicing pass takes at most, whatever the setting: what the threads of
 *  a group hold at three a patch. */
export const MAX_GROUP_PATCHES = 21
/** Vertices of the largest pattern: `(TABLE_SIZE + 1) * (TABLE_SIZE + 2) / 2`. */
export const MAX_PATTERN_VERTICES = 120

/** Patterns the table indexes: every triple of factors, each from 1 to `TABLE_PO2_SIZE`. */
export const TABLE_PATTERNS = TABLE_PO2_SIZE ** 3
/** Words of the table's offsets — two a pattern —, where its vertices and triangles start in the
 *  `tess` buffer: the offsets first. */
export const TABLE_DATA_WORD = 2 * TABLE_PATTERNS
/** The bit of a pattern that says the winding is flipped by the sort of its factors. */
export const PATTERN_FLIP = 0x1000

/** A pattern's index in its table from its three factors, each in `1..TABLE_SIZE`, in any order:
 *  sorted into descending order, `x + y * 16 + z * 256` less the factors' own 1 each. */
export function patternIndex(a: number, b: number, c: number) {
  const [x, y, z] = [a, b, c].sort((p, q) => q - p)
  return x - 1 + (y - 1) * TABLE_PO2_SIZE + (z - 1) * TABLE_PO2_SIZE * TABLE_PO2_SIZE
}
