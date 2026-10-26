import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../../math/src/scalar/reals.ts'

/**
 * THE PER-FRAME LIST OF VISIBLE CLUSTERS, one buffer written by the cluster cull the frame it cuts.
 *
 * Its first words are the header (`VISIBLE_HEADER_WORDS`): the clusters held by the software
 * raster and by the hardware raster, both passes' (together at most `visibleCap`), where the post
 * pass opened in each (`VIS_SW_SPLIT`, `VIS_HW_SPLIT`; `NO_SPLIT` in a cut of one pass), and the
 * clusters asked in all, counted past the room too (`VIS_ASKED`, the peak the readback brings
 * back). Behind them, `VISIBLE_RECORD_WORDS` words a cluster: its page (the packed rank of a
 * placement's cluster), its placement, and a tag (`visibleTag`). The software clusters are written
 * from the bottom of the records, the hardware ones from the top (`visibleCap` records in all): a
 * cluster takes its room from the one count of asks (`VIS_ASKED`) before it takes its place in its
 * list, so the two lists share the room, never meet, and a record is written by one cluster alone;
 * a cluster's index in the buffer is its `VisibleClusterIndex`, the number a visibility identifier
 * carries (`../../../visibility/visWords.ts`).
 */

/** Words of the header, a multiple of sixteen so the records start on a cache line. */
const VISIBLE_HEADER_WORDS = 16
/** The header's words: the software and hardware clusters held, the counts of each when the post
 *  pass opened, and the clusters asked in all. */
const VIS_SW = 0,
  VIS_HW = 1,
  VIS_SW_SPLIT = 2,
  VIS_HW_SPLIT = 3,
  VIS_ASKED = 4
/** The split of a cut with no post pass: past every count. */
const NO_SPLIT = 0xffffffff
/** Words of a record: the page, the placement, the tag. */
export const VISIBLE_RECORD_WORDS = 3
/** The tag: the depth bucket in its low bits (`DEPTH_BUCKETS` of them), and the flags of a cluster
 *  the rasters leave to others — `VIS_TAG_TESSELLATED`, whose patches the tessellation seeds from the
 *  list, and `VIS_TAG_BLENDED`, which the blend pass draws. */
const VIS_TAG_TESSELLATED = 1 << 16,
  VIS_TAG_BLENDED = 1 << 17

/** The list's layout as the kernels that read or write it name it: the cluster cull
 *  (`../shader/visibleWgsl.ts`), the decode and the bins (`../../../visibility/decode/`,
 *  `../../../visibility/bins/`). */
export const VISIBLE_LAYOUT_WGSL = wgslBlock(
  'VISIBLE_LAYOUT_WGSL',
  [],
  wgslConsts({
    VIS_SW,
    VIS_HW,
    VIS_SW_SPLIT,
    VIS_HW_SPLIT,
    VIS_ASKED,
    VISIBLE_HEADER_WORDS,
    VISIBLE_RECORD_WORDS,
    NO_SPLIT,
    VIS_TAG_TESSELLATED,
    VIS_TAG_BLENDED,
  }),
)

/** The bytes of a buffer of `cap` records. */
export const visibleBytes = (cap: number) => 4 * (VISIBLE_HEADER_WORDS + VISIBLE_RECORD_WORDS * cap)

/** The records a cut of `pages` pages, held by the lists' caps, keeps room for at first: the
 *  frame's own demand moves it from there (`./visibleGrowth.ts`). */
export const INITIAL_VISIBLE = 65536

/** `visibleCap` records for a cut whose readback asked `peak` at most: a quarter past the peak,
 *  rounded up to a power of two, at the least the first room and at most `limit`. */
export function visibleCapFor(peak: number, limit: number) {
  const wanted = Math.max(INITIAL_VISIBLE, Math.ceil(peak * 1.25))
  return clampLowWins(nextPow2(wanted), 1, limit)
}

/** The most records a list of visible clusters may hold: the packing's pages, within the cap it
 *  is given (the setting `cutMaxVisibleClusters`, held to the device's binding: `limitedCaps`,
 *  `../lists/cutListCaps.ts`). */
export const visibleLimit = (pages: number, caps: { visible: number }) =>
  clampLowWins(caps.visible, 1, Math.max(1, pages))
