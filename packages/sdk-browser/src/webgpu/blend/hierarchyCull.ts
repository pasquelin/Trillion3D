import { BOX_VALUES, frustumExcludesBox } from '../../../../sdk-core/src/index.ts';
import { notDrawn } from '../../placement/hidden.ts';
import { currentBlendHierarchy } from './hierarchy.ts';
import { includeWaterItem } from '../water/bounds.ts';
import type { createWebgpuBlendState } from './state.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/** Counts of the frame, module scratch so the walk allocates nothing. */
const tally = { rejected: 0, water: 0 };

/**
 * The item-by-item verdict of `rank`: a hidden or parked item is kept out without counting as
 * rejected; without a usable box, it is never rejected. `cut` says its node is rejected: its box
 * would be too (`hierarchy.ts`), and is not tested.
 */
function judge(
  blendState: BlendState,
  rank: number,
  planes: Float64Array,
  mask: Uint32Array,
  cut: boolean,
) {
  const item = blendState.blendGpu[rank],
    box = item.bounds;
  if (notDrawn(item)) return;
  if (box && (cut || frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])))
    tally.rejected++;
  else {
    mask[rank >>> 5] |= 1 << (rank & 31);
    // The water pass is encoded for a surface in view, never for a scene that merely has one;
    // its scissor and copies are bounded by these kept surfaces only (`../water/bounds.ts`).
    if (item.transmissive) {
      tally.water++;
      includeWaterItem(blendState.waterBounds, item, blendState.volumePacked);
    }
  }
}

/**
 * FRUSTUM VERDICT OF THE FRAME, through the box tree: sets `keepPacked` (and `keepMoved` when a
 * word changed) and `transmissiveInView`, returns the items rejected — a hidden or parked item is
 * kept out without counting as rejected. The mask goes to the GPU as one bit per item, and plan
 * expansion zeros the instances of what it rejects (`expandWgsl.ts`).
 *
 * The kept set, mask and counts are those of the item-by-item walk, bit for bit (`hierarchy.ts`
 * holds the invariant, `hierarchy.test.ts` checks it against develop's walk). A rejected node's
 * items are still visited, for the parked test the reject count needs, but no box is tested.
 */
export function cullBlendHierarchy(blendState: BlendState) {
  const planes = blendState.blendPlanes,
    tree = currentBlendHierarchy(blendState);
  const { mask, loose, leaves, first, counts, skip, boxes } = tree;
  mask.fill(0);
  tally.rejected = 0;
  tally.water = 0;
  tree.tested = loose.length;
  for (let k = 0; k < loose.length; k++) judge(blendState, loose[k], planes, mask, false);
  for (let node = 0; node < tree.nodes;) {
    const o = node * BOX_VALUES;
    tree.tested++;
    const cut = frustumExcludesBox(
      planes,
      boxes[o],
      boxes[o + 1],
      boxes[o + 2],
      boxes[o + 3],
      boxes[o + 4],
      boxes[o + 5],
    );
    // A kept inner node is entered; a leaf or a rejected node is judged item by item, then passed.
    if (!cut && !counts[node]) {
      node++;
      continue;
    }
    const end = first[skip[node]];
    if (!cut) tree.tested += end - first[node];
    for (let k = first[node]; k < end; k++) judge(blendState, leaves[k], planes, mask, cut);
    node = skip[node];
  }
  // Written only where a word changed: a still pose changes none, and the GPU copy is spared.
  const keep = blendState.keepPacked;
  let moved = false;
  for (let w = 0; w < mask.length; w++)
    if (keep[w] !== mask[w]) {
      keep[w] = mask[w];
      moved = true;
    }
  blendState.keepMoved = moved;
  blendState.transmissiveInView = tally.water;
  return tally.rejected;
}
