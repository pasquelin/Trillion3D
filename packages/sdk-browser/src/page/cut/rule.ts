/**
 * THE CUT RULE: the GPU kernel (`../../gpu/dag/shader/shader.ts`) and its CPU model
 * (`../../gpu/dag/oracle/oracle.fixture.ts`) decide a cluster with the predicate below, and nothing else
 * draws or withholds a cluster there.
 *
 * A cluster is drawn when it is resident, its parent group is still too coarse for the threshold,
 * and either its own error meets the threshold or the group finer than it is not resident:
 *
 *   draw(c) = resident(c) && parentError(c) > t && (clusterError(c) <= t || !resident(childGroup(c)))
 *
 * The last term, `!resident(childGroup(c))`, keeps a group on screen while the finer group that
 * would replace it is still streaming in: without it the cluster would vanish and leave a hole.
 * Residency is the group-closed one `./readiness.ts` derives, so a surface is drawn exactly once,
 * by the finest resident representation the threshold allows — the wanted cluster or its nearest
 * resident ancestor, never a primitive-wide substitute.
 *
 * Both errors are screen errors in pixels, projected by the caller in its own precision; the rule
 * compares them. The WGSL text is the same expression, operand for operand, split at the two
 * comparisons so a caller that already made them passes their results.
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

/** The rule in WGSL, for the kernel that draws (`dagMask`): `drawsCompared` on the two comparisons
 *  the cut makes, the form a camera's `dagMask` calls on the bits `dagWanted` kept this frame. */
export const CUT_RULE_WGSL = `fn drawsCluster(resident:bool,parentPixels:f32,ownPixels:f32,childResident:bool,threshold:f32)->bool{
 return drawsCompared(resident,parentPixels>threshold,ownPixels<=threshold,childResident);
}
fn drawsCompared(resident:bool,parentAbove:bool,ownWithin:bool,childResident:bool)->bool{
 return resident&&parentAbove&&(ownWithin||!childResident);
}
`;
