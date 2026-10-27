import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { gpuCapsOf } from './gpuCaps.ts'

/** The subgroup sizes `device`'s adapter states, where it states them. */
export const adapterSubgroupSizes = (device: GPUDevice) => {
  const { minLanes, maxLanes } = gpuCapsOf(device).subgroups
  return { subgroupMinSize: minLanes, subgroupMaxSize: maxLanes }
}

/** Whether `device` runs subgroup operations (the `subgroups` feature) on subgroups of at least
 *  `minLanes` lanes, as far as its adapter says: a kernel whose subgroup variant only pays from a
 *  width on asks it; one exact at any width asks none. */
export function hasSubgroups(device: GPUDevice, minLanes = 1) {
  const { present, maxLanes } = gpuCapsOf(device).subgroups
  return present && !(maxLanes > 0 && maxLanes < minLanes)
}

/** Whether every subgroup of `device` holds exactly `lanes` lanes (the `subgroups` feature, its
 *  adapter's least and greatest sizes both `lanes`): a kernel whose subgroups must be its fixed
 *  slices of lanes — the projection's 32-pixel halves — asks it. */
export function hasSubgroupsOf(device: GPUDevice, lanes: number) {
  const { present, minLanes, maxLanes } = gpuCapsOf(device).subgroups
  return present && minLanes === lanes && maxLanes === lanes
}

/** The shadow traces' one subgroup vote, all true over the subgroup's lanes (`subgroupAll`): its
 *  `enable`, and the subgroup uniformity left unchecked — its callers
 *  vote in the flow their own rule makes uniform (the projection's halves, a fragment's lights). */
export const SUBGROUP_ALL_WGSL = wgslBlock(
  'SUBGROUP_ALL_WGSL',
  [],
  `enable subgroups;
diagnostic(off,subgroup_uniformity);
fn subgroupAllTrue(c:bool)->bool{return subgroupAll(c);}`,
)

/** The first of `sizes` that every subgroup of `device` holds exactly, none where it states none. */
export const uniformSubgroupLanes = <T extends number>(device: GPUDevice, sizes: readonly T[]) =>
  sizes.find((lanes) => hasSubgroupsOf(device, lanes))
