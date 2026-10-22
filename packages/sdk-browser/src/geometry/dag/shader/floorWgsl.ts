/**
 * TOP-DOWN PRUNING: a leaf's error floor, under the one cut rule.
 *
 * Every node carries from the manifest the replacement error CEILING, enough to drop a subtree
 * that is too FINE, and its least own error, the FLOOR (`page-codec-wasm/src/culling.rs`). A LEAF
 * — a group part — is dropped as too COARSE when even its floor shows at the largest edge scale of
 * its LOD ball (`edgeScales`, `error.ts`), the ball its ceiling is tested at: no cluster of the
 * part is fine enough anywhere in it. An inner node is never dropped on its floor: its children
 * are tested.
 *
 * Under the cut rule (`../../cut/rule.ts`) a cluster too coarse is still drawn when its
 * finer group is not resident: it is then the nearest resident ancestor of what is missing. The
 * leaf's OPEN count (`../pack/packNodes.ts`, `NODE_OPEN`) says whether its part holds such a
 * cluster, and an open leaf is never dropped on its floor. The frame's own threshold is the
 * only one: nothing is carried from one frame to the next, and no primitive-wide fallback waits
 * behind a dropped floor.
 */
/**
 * Layout of the `work` buffer, in words, as the kernel reads it — `blockBase()`, `liveCounter()` and
 * the frame counters from `levelWgsl.ts`, then the lists' group counts. Set HERE and nowhere else:
 * the engine allocates it (`../resources.ts`) and benches that mount the kernel by hand reread it,
 * so a word added to the kernel cannot leave a caller with a buffer that is too short — where
 * out-of-bounds counters read as zero, and top-down pruning would then drop everything.
 *
 * Each list read indirectly keeps its dispatch argument's x then y behind its counter
 * (`openSlice`), which the arming kernel copies to the argument (`armWgsl.ts`). Behind them the
 * filter's bits, one a placement of the `worldCount` the cut holds (`viewFilterWgsl.ts`): none for
 * a layout made without placements, a bench's.
 */
export function dagWorkLayout(blockCount: number, worldCount = 0) {
  // Block counts, block offsets and `BLOCK_MASK_WORDS` per block of each draw mask (`compactWgsl.ts`):
  // no word per page, so `work` never bounds the pages one binding holds (the kept ranks live in
  // `flags`, `differenceWgsl.ts`).
  const base = blockCount * WORK_BLOCK_WORDS,
    listGroups = base + FRAME_COUNTERS
  return {
    base,
    /** The draw mask, a bit a page, behind the block counts and offsets and the mask the cut
     *  writes (`compactWgsl.ts`): what the draw, the raster and the blended pass read of the cut. */
    drawMask: (2 + BLOCK_MASK_WORDS) * blockCount,
    /** The post pass's draws alone, behind the draw mask: what the second raster pass draws. */
    postMask: (2 + 2 * BLOCK_MASK_WORDS) * blockCount,
    /** The frame counters, in the order `levelWgsl.ts` names them. */
    liveCounter: base,
    liveGroups: base + 1,
    candCounter: base + 6,
    candGroups: base + 7,
    drawnCounter: base + 9,
    drawnGroups: base + 10,
    postNodeGroups: base + 16,
    postClusterGroups: base + 19,
    /** The two kept lists' group counts, then the journal a swap writes back's, then the three
     *  descent queues', x and y each (`armWgsl.ts`). */
    listGroups,
    /** The view's filter, a bit a placement, behind the group counts: written by the host before
     *  a cut whose view filters (`../viewFilterRegion.ts`), read by `filteredOut`. */
    filter: listGroups + 2 * LISTED_GROUPS,
    words: listGroups + 2 * LISTED_GROUPS + ceilDiv(worldCount, 32),
  }
}

/** Words of the frame counters: the live list's counter and argument, three level counters, the
 *  candidates' counter and argument, the drawn log's counter and argument, where each of the three
 *  levels starts in the descent array (`listsWgsl.ts`, `queueStart`), each post list's counter and
 *  argument, where the running pass's candidates and live entries start and the pass itself, then
 *  the nodes each pass opened and the candidate clusters the cut listed (`nodeTotalWord`,
 *  `clusterTotalWord`), and of those the main pass's (`mainClusterWord`). */
const FRAME_COUNTERS = 28
/** The lists whose group counts follow the frame counters (`listGroups`): the two kept lists, the
 *  journal a swap writes back, the three descent queues. */
const LISTED_GROUPS = 6
/** Words of a block's draw mask: a bit for each of its `WORKGROUP_THREADS` pages, a multiple of 32.
 *  Every place a block's mask takes, host and kernel, follows the knob through it. */
export const BLOCK_MASK_WORDS = WORKGROUP_THREADS / 32
/** `BLOCK_MASK_WORDS` as the kernels name it. */
export const BLOCK_MASK_WORDS_WGSL = wgslConst(
  'BLOCK_MASK_WORDS',
  [],
  wgslConsts({ BLOCK_MASK_WORDS }),
)

/** Words of `work` per block of `WORKGROUP_THREADS` pages ahead of the counters: its drawn count, its
 *  offset, the draw mask the running cut writes, the one the frame draws and the post pass's own,
 *  a bit a page each (`compactWgsl.ts`). Under half a byte a page: a binding holds those of a
 *  quarter billion. */
export const WORK_BLOCK_WORDS = 2 + 3 * BLOCK_MASK_WORDS

import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { wgslBlock, wgslConst } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'

export const DAG_FLOOR_WGSL = wgslBlock(
  'DAG_FLOOR_WGSL',
  [],
  `fn extraBase()->u32{return liveCounter()+${FRAME_COUNTERS}u;}
/** A node's verdict: is it a leaf too coarse for the threshold — is its floor seen past the
 *  threshold even at its LOD ball's largest edge scale, \`edge · t < F · scale · floor\`
 *  (\`error.ts\`)? An inner node, an open leaf — one holding a cluster whose finer group is not
 *  resident — and a floor of no error never are, nor any while the host turned this cull off
 *  (\`CULL_MIN_LOD_OFF\`). */
fn floorPrunes(open:u32,node:CullNode,e:mat4x4f)->bool{
 if(cullOff(CULL_MIN_LOD_OFF)){return false;}
 if(node.childCount>0u||open!=0u||!(node.minError>0.0)){return false;}
 return sphereEdges(node.sphere,e).y*views[0u].pixelError<viewPixels()*placedScale.x*node.minError;
}
`,
)
