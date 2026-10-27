import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { wgslBlock, wgslConst } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'

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

/** Words of a block's mask: a bit for each of its `WORKGROUP_THREADS` pages, a multiple of 32.
 *  Every place a block's mask takes, host and kernel, follows the knob through it. */
export const BLOCK_MASK_WORDS = WORKGROUP_THREADS / 32
/** `BLOCK_MASK_WORDS` as the kernels name it. */
export const BLOCK_MASK_WORDS_WGSL = wgslConst(
  'BLOCK_MASK_WORDS',
  [],
  wgslConsts({ BLOCK_MASK_WORDS }),
)

/** The frame counters, as words from the first behind the masks, in the order the kernels name
 *  them (`listsWgsl.ts`): the visible list's dispatch argument; the three descent queues' counters;
 *  the candidates' counter and argument; where each of the three queues starts in the descent array;
 *  each post list's counter and argument; where the running pass's candidates begin and the pass
 *  itself; the nodes each pass opened and the candidate clusters the cut listed, and of those the
 *  main pass's; then the three queues' arguments. */
export const COUNTER = {
  visibleGroups: 0,
  queue: 2,
  cand: 5,
  candGroups: 6,
  queueStart: 8,
  postNode: 11,
  postNodeGroups: 12,
  postCluster: 14,
  postClusterGroups: 15,
  candFirst: 17,
  pass: 18,
  nodeTotal: 19,
  clusterTotal: 21,
  mainCluster: 22,
  queueGroups: 23,
} as const
/** Words of the frame counters. */
export const FRAME_COUNTERS = 29

/**
 * Layout of the `work` buffer, in words, as the kernel reads it — `counterBase()` and the frame
 * counters from `listsWgsl.ts`, then the lists' group counts. Set HERE and nowhere else: the engine
 * allocates it (`../resources.ts`) and benches that mount the kernel by hand reread it, so a word
 * added to the kernel cannot leave a caller with a buffer that is too short — where out-of-bounds
 * counters read as zero, and top-down pruning would then drop everything.
 *
 * The buffer opens with the two masks of the blended clusters the cut draws, a bit a page: the
 * frame's, then the post pass's alone, `BLOCK_MASK_WORDS` per block of `WORKGROUP_THREADS` pages
 * each (`blendMaskWgsl.ts`), under half a byte a page for both: a binding holds those of a quarter
 * billion. Behind them the frame counters (`COUNTER`); each list read indirectly
 * keeps its dispatch argument's x then y among them (`openSlice`), which the arming kernel copies
 * to the argument (`armWgsl.ts`). Behind them the filter's bits, one a placement of the
 * `worldCount` the cut holds (`viewFilterWgsl.ts`): none for a layout made without placements, a
 * bench's.
 */
export function dagWorkLayout(blockCount: number, worldCount = 0) {
  const mask = blockCount * BLOCK_MASK_WORDS,
    base = 2 * mask
  return {
    base,
    /** The frame's mask of blended clusters drawn, behind which the post pass's alone lies:
     *  what the blended pass reads of the cut (`blendMaskWgsl.ts`). */
    drawMask: 0,
    postMask: mask,
    /** The words each list's dispatch argument lies at, x then y (`armWgsl.ts`). */
    visibleGroups: base + COUNTER.visibleGroups,
    candGroups: base + COUNTER.candGroups,
    postNodeGroups: base + COUNTER.postNodeGroups,
    postClusterGroups: base + COUNTER.postClusterGroups,
    /** The three descent queues' arguments, one pair each. */
    queueGroups: base + COUNTER.queueGroups,
    /** The view's filter, a bit a placement, behind the counters: written by the host before
     *  a cut whose view filters (`../viewFilterRegion.ts`), read by `filteredOut`. */
    filter: base + FRAME_COUNTERS,
    words: base + FRAME_COUNTERS + ceilDiv(worldCount, 32),
  }
}

/** The floor's guard, the camera's and the shadow views' alike: whether a node can be dropped on its floor
 *  at all — a leaf with a floor of some error, while the host has not turned this cull off
 *  (\`CULL_MIN_LOD_OFF\`). Whether the leaf is open is the view's own. */
export const DAG_FLOOR_GUARD_WGSL = wgslBlock(
  'DAG_FLOOR_GUARD_WGSL',
  [],
  `fn floorApplies(node:CullNode)->bool{
 return !cullOff(CULL_MIN_LOD_OFF)&&node.childCount==0u&&node.minError>0.0;
}
`,
)

export const DAG_FLOOR_WGSL = wgslBlock(
  'DAG_FLOOR_WGSL',
  [DAG_FLOOR_GUARD_WGSL],
  `/** A node's verdict: is it a leaf too coarse for the threshold — is its floor seen past the
 *  threshold even at its LOD ball's largest edge scale, \`edge · t < F · scale · floor\`
 *  (\`error.ts\`)? An inner node, an open leaf — one holding a cluster whose finer group is not
 *  resident — and a floor of no error never are, nor any while the host turned this cull off
 *  (\`floorApplies\`). */
fn floorPrunes(open:u32,node:CullNode,e:mat4x4f)->bool{
 if(!floorApplies(node)||open!=0u){return false;}
 return sphereEdges(node.sphere,e).y*cutView.pixelError<viewPixels()*placedScale.x*node.minError;
}
`,
)
