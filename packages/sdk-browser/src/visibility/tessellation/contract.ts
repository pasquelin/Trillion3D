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
 *  `end`, the patches the pass's occlusion test hid, kept for the post pass (`ARG_OCCLUDED`), and
 *  the windows the shadow maps' seeding opened (`ARG_WINDOWS`, see `WINDOW_WORDS`) and the patches of the static layer
 *  they list apart (`ARG_VISIBLE_STATIC`, filled from the end of the visible list); `ARG_LISTED` counts every listing asked, both layers',
 *  a count past the list's room being the loss: the two layers' patches kept never overlap. */
export const ARG_QUEUE = 0,
  ARG_VISIBLE = 1,
  ARG_LEVEL = 2,
  ARG_START = 3,
  ARG_END = 4,
  ARG_OCCLUDED = 5,
  ARG_WINDOWS = 6,
  ARG_VISIBLE_STATIC = 7,
  ARG_LISTED = 8,
  PASS_ARG_WORDS = 9
/** The lists of visible patches a chain keeps in its region of the visible buffer, a layer each (the image has the first only): the counter of the
 *  layer's state, and where its patches lie, from the start of the region or from its end (`fromEnd`), so that the two runs never meet. */
export const VISIBLE_LISTS = [
  { counter: ARG_VISIBLE, fromEnd: false },
  { counter: ARG_VISIBLE_STATIC, fromEnd: true },
] as const
/** The patches a chain lost, four words each in a region of their own at the end of the `tess` buffer (`tessLayout`), which the chain's state's
 *  clearing leaves be and the readback of the losses clears (`LOSS_*` the words): the patches the splitting queue had no room for, those the
 *  visible list had none for, the shadow maps' windows past the chain's room, and the patches its occlusion test hid that the buffer that keeps them for the post pass had no room for. */
export const LOSS_QUEUE = 0,
  LOSS_VISIBLE = 1,
  LOSS_WINDOWS = 2,
  LOSS_OCCLUDED = 3,
  LOSS_WORDS = 4
/** What the dicing does with a micro-triangle that has a vertex before the raster's near plane: drops it (`NEAR_DROP`, the image's), cuts it by the plane and
 *  keeps the part in front (`NEAR_CUT`, a shadow map with a near clip), or keeps it whole (`NEAR_KEEP`, a map with none). */
export const NEAR_DROP = 0,
  NEAR_CUT = 1,
  NEAR_KEEP = 2
/** The dispatches the levels and the dicing are launched with, in a buffer of their own — a buffer
 *  a dispatch reads its size from is bound to no kernel that writes it —: for each chain the
 *  splitting's workgroups (x, y, z), then the dicing's, then those that take the occluded patches up
 *  again in the post pass, then the shadow maps' seeding's, the one that fills the windows
 *  the seeding opened and last the dicing's of their static layer's patches. */
export const DISPATCH_SPLIT = 0,
  DISPATCH_DICE = 3,
  DISPATCH_RESUME = 6,
  DISPATCH_SEED = 9,
  DISPATCH_WINDOWS = 12,
  DISPATCH_DICE_STATIC = 15,
  PASS_DISPATCH_WORDS = 18
/** The byte of the `dispatch` buffer where the dispatch `word` (`DISPATCH_*`) of `chain` lies. */
export const dispatchOffset = (chain: number, word: number) =>
  (chain * PASS_DISPATCH_WORDS + word) * 4
/**
 * THE WINDOW OF A SHADOW MAP RECORD, a block of the `tess` buffer, which the patches of the record's
 * surface name (`window << 8 | triangle`) in place of the record, so that the dicing, which binds
 * neither the pass's records, nor the maps' projections, nor the page table (the eight storage
 * buffers every device holds), reads them there: the record's four words (`WINDOW_RECORD_WORDS`), the view of
 * its map (`WINDOW_VIEW_WORDS`: the `WINDOW_VIEW_RECORDS` vectors `vsmPackView` lays, then the `WINDOW_LENS_WORDS` of the lens of the record's mip: focal length,
 * near plane, whether perspective) and the pool address of each page of its window (`WINDOW_PAGE_SLOTS`, a square
 * of `WINDOW_PAGE_SIDE` pages a side, the software raster's window, `VSM_RENDER_NO_PAGE` where a page is not one to draw). The seeding opens it and writes the record, the
 * kernel after the levels fills the rest; a main pass's windows stay through the post pass, which opens its own after
 * them, as the patches the main pass hid name them.
 */
const WINDOW_RECORD_WORDS = 4
export const WINDOW_VIEW_AT = WINDOW_RECORD_WORDS,
  WINDOW_VIEW_RECORDS = 6,
  WINDOW_LENS_WORDS = 4,
  WINDOW_VIEW_WORDS = WINDOW_VIEW_RECORDS * 4 + WINDOW_LENS_WORDS,
  WINDOW_LENS_AT = WINDOW_VIEW_AT + WINDOW_VIEW_RECORDS * 4,
  WINDOW_POOL_AT = WINDOW_VIEW_AT + WINDOW_VIEW_WORDS,
  WINDOW_PAGE_SIDE = 8,
  WINDOW_PAGE_SLOTS = WINDOW_PAGE_SIDE * WINDOW_PAGE_SIDE,
  WINDOW_WORDS = WINDOW_POOL_AT + WINDOW_PAGE_SLOTS
/** The windows a chain may open, for a queue of `maxCandidate` patches: one for each `WINDOW_PATCHES`
 *  of them, at least one. */
const WINDOW_PATCHES = 64
export const windowCapacity = (maxCandidate: number) =>
  Math.max(1, Math.ceil(maxCandidate / WINDOW_PATCHES))
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
