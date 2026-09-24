/**
 * TOP-DOWN PRUNING: the subtree error floor, and the two words per primitive that keep it
 * safe under residency escalation.
 *
 * The node carries from the manifest the replacement error CEILING, enough to drop a subtree
 * that is too FINE. It carries from `packCullingNodes` the own-error FLOOR, enough to drop
 * the too COARSE as well: above the threshold none of its clusters is fine enough, so none
 * would be kept and the descent need not list them. That is the half the CPU cut already
 * applied (`../../../page/cut/node.ts`) and the GPU did not.
 *
 * TWO WORDS PER PRIMITIVE, because residency escalation raises the threshold AFTER descent.
 * A coarse level dropped at the frame's threshold is exactly the one escalation would then
 * ask for to replace a missing cluster: without a guard the primitive would have nothing to
 * draw.
 *
 * Both are per SLOT — a primitive seen from one view (`viewsWgsl.ts`); a camera's slot is its primitive.
 *
 * - `pruneSlot(slot)` — the threshold at which descent prunes. `dagPrepare` stores the previous
 *   frame's FINAL threshold, still in `work[slot]` when it clears it: a primitive that escalates
 *   keeps its coarse candidate levels while it escalates, and descends again on its own when
 *   it becomes complete. No extra state, no extra pass.
 * - `floorSlot(slot)` — the smallest floor descent dropped. If escalation goes above it,
 *   `dagMask` arms the pinned fallback rather than drawing coverage it knows is incomplete.
 *   Clusters nothing replaces are never pruned (`NODE_HAS_ROOT`), so that fallback always
 *   has something to cover the primitive.
 */
/** The two words per primitive pruning adds after `work`'s nine frame counters: its
 *  threshold, and the smallest floor it dropped. `../resources.ts` allocates them. */
const LEVEL_WORLD_WORDS = 2;

/**
 * Layout of the `work` buffer, in words, as the kernel reads it — `blockBase()`,
 * `liveCounter()` and the nine frame counters from `levelWgsl.ts`, then the
 * per-primitive pruning words, then the per-view words (`viewsWgsl.ts`). Set HERE and
 * nowhere else: the engine allocates it (`../resources.ts`) and benches that mount the
 * kernel by hand reread it, so a word added to the kernel can no longer leave a caller
 * with a buffer that is too short — where out-of-bounds counters read as zero, and
 * top-down pruning would then drop everything.
 *
 * `views` is the view capacity the buffer serves: one for a camera; a light cut's per-primitive
 * words are one row per view (`slots()`).
 */
export function dagWorkLayout(blockCount: number, worldCount: number, views = 1) {
  const slots = worldCount * views,
    base = slots * 2 + blockCount * 2,
    extra = base + 9,
    viewWords = extra + slots * LEVEL_WORLD_WORDS;
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
    drawnGroupsMax: viewWords + VIEW_WORD_ROWS * views,
    words: viewWords + VIEW_WORD_ROWS * views + 1,
  };
}

import { NODE_HAS_ROOT } from '../packNodes.ts';
import { VIEW_WORD_ROWS } from './viewsWgsl.ts';

export const DAG_FLOOR_WGSL = `fn extraBase()->u32{return liveCounter()+9u;}
fn pruneSlot(slot:u32)->u32{return extraBase()+slot;}
fn floorSlot(slot:u32)->u32{return extraBase()+slots()+slot;}
/** f32 infinity: no finite floor is greater, so nothing is crossed until something
 *  has been dropped. \`atomicMin\` on the bits is \`min\` on the floats, all positive here. */
const FLOOR_NONE:u32=0x7f800000u;
fn pruneCrossed(slot:u32)->bool{return bitcast<f32>(atomicLoad(&work[slot]))>bitcast<f32>(atomicLoad(&work[floorSlot(slot)]));}
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
/** Pruning's frame open: the previous frame's threshold becomes the one descent prunes at,
 *  never below this frame's, and the dropped floor resets to \`FLOOR_NONE\`.
 *  \`work[slot]\` still holds the previous frame's final threshold: the caller clears it AFTER,
 *  with the frame threshold this returns. A row fresh to its view carries nothing. */
fn resetPrune(slot:u32)->f32{
 let seuil=max(views[vi].pixelError,0.0);
 let carried=select(bitcast<f32>(atomicLoad(&work[slot])),seuil,stateFresh());
 atomicStore(&work[pruneSlot(slot)],bitcast<u32>(select(seuil,carried,carried>seuil&&carried<INF)));
 atomicStore(&work[floorSlot(slot)],FLOOR_NONE);
 return seuil;
}
/** A node's verdict: is its subtree too coarse for its primitive's prune threshold?
 *  A subtree that carries a cluster nothing replaces never is. */
fn floorPrunes(slot:u32,flags:u32,sphere:vec4f,error:f32,e:mat4x4f,stretch:f32,focal:f32)->bool{
 if((flags&${NODE_HAS_ROOT}u)!=0u){return false;}
 // Depth only: the full product would throw three quarters away. Same form as
 // \`viewDepthOf\` (../../../page/selection/projection.ts), quatre multiplications au lieu de seize.
 let depth=-(e[0].z*sphere.x+e[1].z*sphere.y+e[2].z*sphere.z+e[3].z);
 let low=errorFloor(error,depth,sphere.w,stretch,focal);
 if(low<=bitcast<f32>(atomicLoad(&work[pruneSlot(slot)]))){return false;}
 atomicMin(&work[floorSlot(slot)],bitcast<u32>(low));
 return true;
}
`;
