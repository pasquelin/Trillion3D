/**
 * TOP-DOWN PRUNING: the subtree error floor, and the two words per primitive that keep it
 * safe under residency escalation.
 *
 * The node carries from the manifest the replacement error CEILING, enough to drop a subtree
 * that is too FINE. It carries from `packCullingNodes` the own-error FLOOR, enough to drop
 * the too COARSE as well: above the threshold none of its clusters is fine enough, so none
 * would be kept and the descent need not list them. That is the half the CPU cut already
 * applied (`pageSelectionCutNode.ts`) and the GPU did not.
 *
 * TWO WORDS PER PRIMITIVE, because residency escalation raises the threshold AFTER descent.
 * A coarse level dropped at the frame's threshold is exactly the one escalation would then
 * ask for to replace a missing cluster: without a guard the primitive would have nothing to
 * draw.
 *
 * - `pruneSlot(w)` — the threshold at which descent prunes. `dagPrepare` stores the previous
 *   frame's FINAL threshold, still in `work[w]` when it clears it: a primitive that escalates
 *   keeps its coarse candidate levels while it escalates, and descends again on its own when
 *   it becomes complete. No extra state, no extra pass.
 * - `floorSlot(w)` — the smallest floor descent dropped. If escalation goes above it,
 *   `dagMask` arms the pinned fallback rather than drawing coverage it knows is incomplete.
 *   Clusters nothing replaces are never pruned (`NODE_HAS_ROOT`), so that fallback always
 *   has something to cover the primitive.
 */
/** The two words per primitive pruning adds after `work`'s nine frame counters: its
 *  threshold, and the smallest floor it dropped. `gpuDagResources.ts` allocates them. */
const LEVEL_WORLD_WORDS = 2;

/**
 * Layout of the `work` buffer, in words, as the kernel reads it — `blockBase()`,
 * `liveCounter()` and the nine frame counters from `gpuDagLevelWgsl.ts`, then the
 * per-primitive pruning words. Set HERE and nowhere else: the engine allocates it
 * (`gpuDagResources.ts`) and benches that mount the kernel by hand reread it, so a
 * word added to the kernel can no longer leave a caller with a buffer that is too
 * short — where out-of-bounds counters read as zero, and top-down pruning would
 * then drop everything.
 */
export function dagWorkLayout(blockCount: number, worldCount: number) {
  const base = worldCount * 2 + blockCount * 2;
  return {
    base,
    /** The nine frame counters, in the order `gpuDagLevelWgsl.ts` names them. */
    liveCounter: base,
    liveGroups: base + 1,
    candCounter: base + 5,
    candGroups: base + 6,
    drawnCounter: base + 7,
    drawnGroups: base + 8,
    words: base + 9 + worldCount * LEVEL_WORLD_WORDS,
  };
}

import { NODE_HAS_ROOT } from './gpuDagPackNodes.ts';

export const DAG_FLOOR_WGSL = `fn extraBase()->u32{return liveCounter()+9u;}
fn pruneSlot(w:u32)->u32{return extraBase()+w;}
fn floorSlot(w:u32)->u32{return extraBase()+uni.worldCount+w;}
/** f32 infinity: no finite floor is greater, so nothing is crossed until something
 *  has been dropped. \`atomicMin\` on the bits is \`min\` on the floats, all positive here. */
const FLOOR_NONE:u32=0x7f800000u;
fn pruneCrossed(w:u32)->bool{return bitcast<f32>(atomicLoad(&work[w]))>bitcast<f32>(atomicLoad(&work[floorSlot(w)]));}
/** GPU mirror of \`errorFloorAt\` (pageSelectionProjection.ts): same guards, same operands, same
 *  order. The smallest subtree error seen at the farthest depth its bounding sphere allows —
 *  never above the true value of one of its clusters. Without a sphere, negative radius, it
 *  certifies nothing and returns zero. GPU proof:
 *  \`test/justesse/plancher-erreur-cpu-gpu.ts\`. */
fn errorFloor(error:f32,depth:f32,radius:f32,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)||!(radius>=0.0)){return 0.0;}
 let far=depth+radius*stretch;
 if(!(far>0.0)){return INF;}
 return (error*stretch*focal)/far;
}
/** Pruning's frame open: the previous frame's threshold becomes the one descent prunes at,
 *  never below this frame's, and the dropped floor resets to \`FLOOR_NONE\`.
 *  \`work[w]\` still holds the previous frame's final threshold: the caller clears it AFTER,
 *  with the frame threshold this returns. */
fn resetPrune(w:u32)->f32{
 let seuil=max(uni.pixelError,0.0);
 let carried=bitcast<f32>(atomicLoad(&work[w]));
 atomicStore(&work[pruneSlot(w)],bitcast<u32>(select(seuil,carried,carried>seuil&&carried<INF)));
 atomicStore(&work[floorSlot(w)],FLOOR_NONE);
 return seuil;
}
/** A node's verdict: is its subtree too coarse for its primitive's prune threshold?
 *  A subtree that carries a cluster nothing replaces never is. */
fn floorPrunes(w:u32,flags:u32,sphere:vec4f,error:f32,e:mat4x4f,stretch:f32,focal:f32)->bool{
 if((flags&${NODE_HAS_ROOT}u)!=0u){return false;}
 // Depth only: the full product would throw three quarters away. Same form as
 // \`viewDepthOf\` (pageSelectionProjection.ts), quatre multiplications au lieu de seize.
 let depth=-(e[0].z*sphere.x+e[1].z*sphere.y+e[2].z*sphere.z+e[3].z);
 let low=errorFloor(error,depth,sphere.w,stretch,focal);
 if(low<=bitcast<f32>(atomicLoad(&work[pruneSlot(w)]))){return false;}
 atomicMin(&work[floorSlot(w)],bitcast<u32>(low));
 return true;
}
`;
