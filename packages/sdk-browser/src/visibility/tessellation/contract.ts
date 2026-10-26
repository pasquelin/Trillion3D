/**
 * The tessellation's numbers, written once for the host that builds its tables and the WGSL that
 * reads them. A triangle is cut by a PATTERN: a triangle of 15-bit fixed-point barycentric
 * vertices and the triangles that join them, one for every triple of edge factors; a patch is a
 * sub-triangle of a source triangle, named by the barycentrics of its three corners.
 */

/** The largest factor an edge of a pattern takes: a triangle with a larger one is split first. */
export const TABLE_SIZE = 14
/** The pattern table's stride: its index is `x + y * 16 + z * 256`, the factors counted from 0. */
export const TABLE_STRIDE = 16
/** The largest factor of the patches a triangle is first cut into: one that needs more than this
 *  is cut by `TABLE_SIZE`-ths, at most this many pieces an edge, and each piece cut again. */
export const SEED_SPLIT_LIMIT = 8
/** The levels a triangle is split in at most. */
export const MAX_SPLIT_LEVELS = 6
/** A barycentric coordinate is a fraction of this, a power of two: 15 bits. */
export const BARYCENTRIC_ONE = 1 << 15
/** Words of a patch: the source triangle's identifier, then its three corners' barycentrics. */
export const PATCH_WORDS = 4
/** The words of a pass's state, in the `tess` buffer, a pass's from its own base: the patches the
 *  queue was asked for (a count past its capacity is the loss), the patches the visible list was
 *  asked for, the level being split, and the slots of the queue that level holds, `start` to
 *  `end`, the patches the pass's occlusion test hid, kept for the post pass (`ARG_OCCLUDED`), and the
 *  most triangles any visible patch's pattern holds, which the shadow maps' draw is sized by
 *  (`ARG_MAX_TRIANGLES`). */
export const ARG_QUEUE = 0,
  ARG_VISIBLE = 1,
  ARG_LEVEL = 2,
  ARG_START = 3,
  ARG_END = 4,
  ARG_OCCLUDED = 5,
  ARG_MAX_TRIANGLES = 6,
  PASS_ARG_WORDS = 8
/** The dispatches the levels and the dicing are launched with, in a buffer of their own — a buffer
 *  a dispatch reads its size from is bound to no kernel that writes it —: for each chain the
 *  splitting's workgroups (x, y, z), then the dicing's, then those that take the occluded patches up
 *  again in the post pass, then the shadow maps' seeding's and last the arguments of their draw
 *  (vertex count, instance count, first vertex, first instance). */
export const DISPATCH_SPLIT = 0,
  DISPATCH_DICE = 3,
  DISPATCH_RESUME = 6,
  DISPATCH_SEED = 9,
  DISPATCH_DRAW = 12,
  PASS_DISPATCH_WORDS = 16
/** Which pyramid a pass's occlusion test of the patches reads: none, the previous image's — the main
 *  pass's, which keeps what it hides for the post pass — or the image's own, built from what the main
 *  pass drew — the post pass's, which drops what it hides. */
export const OCCLUSION_NONE = 0,
  OCCLUSION_MAIN = 1,
  OCCLUSION_POST = 2
/** The patches a group of the dicing pass takes at most, whatever the setting: what the threads of
 *  a group hold at three a patch. */
export const MAX_GROUP_PATCHES = 21
/** Vertices of the largest pattern: `(TABLE_SIZE + 1) * (TABLE_SIZE + 2) / 2`. */
export const MAX_PATTERN_VERTICES = 120

/** Patterns the table indexes: every triple of factors, each from 1 to `TABLE_STRIDE`. */
const TABLE_PATTERNS = TABLE_STRIDE ** 3
/** Words of the table's offsets — two a pattern —, where its vertices and triangles start in the
 *  `tess` buffer: the offsets first. */
export const TABLE_DATA_WORD = 2 * TABLE_PATTERNS
/** The bit of a pattern that says the winding is flipped by the sort of its factors. */
export const PATTERN_FLIP = 0x1000
