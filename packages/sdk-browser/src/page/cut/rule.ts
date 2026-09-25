/**
 * THE CUT RULE, the only one: every backend — the GPU kernel (`../../gpu/dag/shader/shader.ts`),
 * its CPU model (`../../gpu/dag/oracle/oracle.ts`) and the CPU cut (`./take.ts`) — decides a
 * cluster with the predicate below, and nothing else draws or withholds a cluster.
 *
 * A cluster is drawn when it is resident, its parent group is still too coarse for the threshold,
 * and either its own error meets the threshold or the group finer than it is not resident:
 *
 *   draw(c) = resident(c) && parentError(c) > t && (clusterError(c) <= t || !resident(childGroup(c)))
 *
 * Nanite (SIGGRAPH 2021) and `vk_lod_clusters` streaming draw a group whose finer group is not
 * resident: that is the last term. Residency is the group-closed one `./readiness.ts` derives, so
 * a surface is drawn exactly once, by the finest resident representation the threshold allows —
 * the wanted cluster or its nearest resident ancestor, never a primitive-wide substitute.
 *
 * Both errors are screen errors in pixels, projected by the caller in its own precision; the rule
 * compares them. The WGSL text is the same expression, operand for operand.
 */
export function drawsCluster(
  resident: boolean,
  parentPixels: number,
  ownPixels: number,
  childResident: boolean,
  threshold: number,
) {
  return resident && parentPixels > threshold && (ownPixels <= threshold || !childResident);
}

/** The rule in WGSL, for the kernel that draws (`dagMask`). */
export const CUT_RULE_WGSL = `fn drawsCluster(resident:bool,parentPixels:f32,ownPixels:f32,childResident:bool,threshold:f32)->bool{
 return resident&&parentPixels>threshold&&(ownPixels<=threshold||!childResident);
}
`;
