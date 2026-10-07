/**
 * TOP-DOWN PRUNING: the subtree error floor, under the one cut rule.
 *
 * The node carries from the manifest the replacement error CEILING, enough to drop a subtree
 * that is too FINE. It carries from `packCullingNodes` the own-error FLOOR, enough to drop
 * the too COARSE as well: above the threshold none of its clusters is fine enough. That is the
 * half the oracle applies too (`../oracle/nodeVerdict.fixture.ts`).
 *
 * Under the cut rule (`../../../page/cut/rule.ts`) a cluster too coarse is still drawn when its
 * finer group is not resident: it is then the nearest resident ancestor of what is missing. The
 * node's OPEN count (`../packNodes.ts`, `NODE_OPEN`) says whether its subtree holds such a
 * cluster, and an open subtree is never dropped on its floor. The frame's own threshold is the
 * only one: nothing is carried from one frame to the next, and no primitive-wide fallback waits
 * behind a dropped floor.
 */
/**
 * Layout of the `work` buffer, in words, as the kernel reads it — `blockBase()`,
 * `liveCounter()` and the twelve frame counters from `levelWgsl.ts`, then the camera's
 * per-view words (`viewsWgsl.ts`) and the frame count. Set HERE and
 * nowhere else: the engine allocates it (`../resources.ts`) and benches that mount the
 * kernel by hand reread it, so a word added to the kernel cannot leave a caller
 * with a buffer that is too short — where out-of-bounds counters read as zero, and
 * top-down pruning would then drop everything.
 *
 * Each list read indirectly keeps its dispatch argument's x then y behind its counter
 * (`openSlice`), which the arming kernel copies to the argument (`armWgsl.ts`).
 */
export function dagWorkLayout(blockCount: number) {
  // Block counts, block offsets and two words per block of the draw mask (`compactWgsl.ts`): no
  // word per page, so `work` never bounds the pages one binding holds (the kept ranks live in
  // `flags`, `differenceWgsl.ts`).
  const base = blockCount * WORK_BLOCK_WORDS,
    viewWords = base + FRAME_COUNTERS,
    drawnGroupsMax = viewWords + VIEW_WORD_ROWS
  return {
    base,
    /** The twelve frame counters, in the order `levelWgsl.ts` names them. */
    liveCounter: base,
    liveGroups: base + 1,
    candCounter: base + 6,
    candGroups: base + 7,
    drawnCounter: base + 9,
    drawnGroups: base + 10,
    /** The word behind the camera's per-view rows (`VIEW_WORD_ROWS`, one word each). */
    drawnGroupsMax,
    /** The camera cuts run so far, the clock of each page's last use (`lastUseWgsl.ts`). */
    frame: drawnGroupsMax + 1,
    /** The two kept lists' group counts, then the journal a swap writes back's, x and y each
     *  (`armWgsl.ts`). */
    listGroups: drawnGroupsMax + 2,
    words: drawnGroupsMax + 8,
  }
}

/** Words of the frame counters: the live list's counter and argument, three queue counters, the
 *  candidates' counter and argument, the drawn log's counter and argument. */
const FRAME_COUNTERS = 12
/** Words of `work` per block of sixty-four pages ahead of the counters: its drawn count, its
 *  offset and its draw mask, a bit a page (`compactWgsl.ts`). A quarter of a byte a page: a binding
 *  holds those of half a billion pages. */
export const WORK_BLOCK_WORDS = 2 + SELECTION_WORKGROUP / 32

import { VIEW_WORD_ROWS } from './viewsWgsl.ts'
import { SELECTION_WORKGROUP } from '../../core/selection.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { DAG_INF } from './infDecl.ts'

export const DAG_FLOOR_WGSL = wgslBlock(
  'DAG_FLOOR_WGSL',
  [DAG_INF],
  `fn extraBase()->u32{return liveCounter()+${FRAME_COUNTERS}u;}
/** GPU mirror of \`errorFloorAt\` (../../../page/selection/projection.ts): same guards, same operands, same
 *  order. The smallest subtree error seen at the farthest depth its bounding sphere allows —
 *  never above the true value of one of its clusters. Without a sphere, negative radius, it
 *  certifies nothing and returns zero. GPU proof:
 *  \`tests/gpu/dag/error-floor.gpu.ts\`. */
fn errorFloor(error:f32,depth:f32,radius:f32,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)||!(radius>=0.0)){return 0.0;}
 let p=views[vi].perspective;let far=p*(depth+radius*stretch)+(1.0-p);
 if(!(far>0.0)){return INF;}
 return (error*stretch*focal)/far;
}
/** A node's verdict: is its subtree too coarse for the frame's threshold? An open subtree —
 *  one holding a cluster whose finer group is not resident — never is. */
fn floorPrunes(open:u32,sphere:vec4f,error:f32,e:mat4x4f,stretch:f32,focal:f32)->bool{
 if(deformReach>0.0){return false;}
 if(open!=0u){return false;}
 // Depth only: the full product would throw three quarters away. Same form as
 // \`viewDepthOf\` (../../../page/selection/projection.ts), four multiplications instead of sixteen.
 let depth=-(e[0].z*sphere.x+e[1].z*sphere.y+e[2].z*sphere.z+e[3].z);
 // A deformation's reach grows a sphere that is there; an absent one (negative) stays so.
 let radius=select(sphere.w,sphere.w+deformReach,sphere.w>=0.0);
 return errorFloor(error,depth,radius,stretch,focal)>views[vi].pixelError;
}
`,
)
