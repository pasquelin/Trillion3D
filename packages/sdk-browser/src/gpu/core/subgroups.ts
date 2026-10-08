/** Whether `device` runs subgroup operations (the `subgroups` feature) on subgroups of at least
 *  `minLanes` lanes, as far as its adapter says: a kernel whose subgroup variant only pays from a
 *  width on asks it; one exact at any width asks none. */
export function hasSubgroups(device: GPUDevice, minLanes = 1) {
  const max = (device as { adapterInfo?: { subgroupMaxSize?: number } }).adapterInfo
    ?.subgroupMaxSize
  return device.features.has('subgroups') && !(max !== undefined && max > 0 && max < minLanes)
}
