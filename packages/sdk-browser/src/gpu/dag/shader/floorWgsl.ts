/**
 * TOP-DOWN PRUNING: the subtree error floor, under the one cut rule.
 *
 * The node carries from the manifest the replacement error CEILING, enough to drop a subtree
 * that is too FINE. It carries from `packCullingNodes` the own-error FLOOR, enough to drop
 * the too COARSE as well: above the threshold none of its clusters is fine enough. That is the
 * half the CPU cut applies too (`../../../page/cut/node.ts`).
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
 * `liveCounter()` and the nine frame counters from `levelWgsl.ts`, then the
 * per-view words (`viewsWgsl.ts`). Set HERE and
 * nowhere else: the engine allocates it (`../resources.ts`) and benches that mount the
 * kernel by hand reread it, so a word added to the kernel can no longer leave a caller
 * with a buffer that is too short — where out-of-bounds counters read as zero, and
 * top-down pruning would then drop everything.
 *
 * `views` is the view capacity the buffer serves: one for a camera, one row each for a light cut.
 * `pages` is the catalogue a light cut asks for: one word per page behind the rest, its best request
 * of the frame (`askedWord`, `snapshotWgsl.ts`); a camera, which asks for a page once, has none.
 */
export function dagWorkLayout(blockCount: number, views = 1, pages = 0) {
  const base = blockCount * 2,
    viewWords = base + 9,
    drawnGroupsMax = viewWords + VIEW_WORD_ROWS * views,
    askedAt = drawnGroupsMax + 1;
  return {
    base,
    /** The nine frame counters, in the order `levelWgsl.ts` names them. */
    liveCounter: base,
    liveGroups: base + 1,
    candCounter: base + 5,
    candGroups: base + 6,
    drawnCounter: base + 7,
    drawnGroups: base + 8,
    /** First per-view word: row `r` (`VIEW_WORD_ROWS`) of view `v` is `viewWords + r * views + v`. */
    viewWords,
    /** The most sixty-four-wide groups any view drew, behind the per-view rows. */
    drawnGroupsMax,
    /** The frame's best request of each page, behind it: `askedWords` words, cleared at the
     *  frame's first cut. */
    askedAt,
    askedWords: pages,
    words: askedAt + pages,
  };
}

import { VIEW_WORD_ROWS } from './viewsWgsl.ts';

export const DAG_FLOOR_WGSL = `fn extraBase()->u32{return liveCounter()+9u;}
/** GPU mirror of \`errorFloorAt\` (../../../page/selection/projection.ts): same guards, same operands, same
 *  order. The smallest subtree error seen at the farthest depth its bounding sphere allows —
 *  never above the true value of one of its clusters. Without a sphere, negative radius, it
 *  certifies nothing and returns zero. GPU proof:
 *  \`tests/browser/probes/error-floor-cpu-gpu.ts\`. */
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
 if(open!=0u){return false;}
 // Depth only: the full product would throw three quarters away. Same form as
 // \`viewDepthOf\` (../../../page/selection/projection.ts), four multiplications instead of sixteen.
 let depth=-(e[0].z*sphere.x+e[1].z*sphere.y+e[2].z*sphere.z+e[3].z);
 return errorFloor(error,depth,sphere.w,stretch,focal)>views[vi].pixelError;
}
`;
