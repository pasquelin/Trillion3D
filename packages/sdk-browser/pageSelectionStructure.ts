import type { ClusterStructure } from '../sdk-core/src/index.ts';
import type { ClusterStructureIndex } from './pageSelectionTypes.ts';

/**
 * Group links of a primitive, flattened once and shared by every instance of it: which group
 * produced a cluster, which group replaces it, and the error band of each group.
 */
export function structureIndex(
  structure: ClusterStructure | null | undefined,
  pageCount: number,
  /** Added to every group's band, exactly as `clusterErrorFields` adds it to a cluster's. */
  quantizationError = 0,
): ClusterStructureIndex | undefined {
  if (!structure || !Array.isArray(structure.groups) || !Array.isArray(structure.roots))
    return undefined;
  const groupCount = structure.groups.length;
  if (!groupCount) return undefined;
  const childOffsets = new Int32Array(groupCount + 1),
    outputOffsets = new Int32Array(groupCount + 1);
  for (let g = 0; g < groupCount; g++) {
    childOffsets[g + 1] = childOffsets[g] + structure.groups[g].children.length;
    outputOffsets[g + 1] = outputOffsets[g] + structure.groups[g].outputs.length;
  }
  const children = new Int32Array(childOffsets[groupCount]),
    outputs = new Int32Array(outputOffsets[groupCount]);
  const sources = new Int32Array(pageCount).fill(-1),
    owners = new Int32Array(pageCount).fill(-1);
  const error = new Float64Array(groupCount),
    sphere = new Float64Array(groupCount * 4);
  for (let g = 0; g < groupCount; g++) {
    const group = structure.groups[g];
    if (!(group.error >= 0) || !Array.isArray(group.sphere) || group.sphere.length !== 4)
      throw new Error(`Group ${g} without error or bounds`);
    error[g] = group.error + quantizationError;
    for (let a = 0; a < 4; a++) sphere[g * 4 + a] = group.sphere[a];
    let at = childOffsets[g];
    for (const child of group.children) {
      if (!(child >= 0 && child < pageCount))
        throw new Error(`Group ${g} references an unknown page`);
      if (owners[child] >= 0) throw new Error(`Page ${child} belongs to two groups`);
      owners[child] = g;
      children[at++] = child;
    }
    at = outputOffsets[g];
    for (const output of group.outputs) {
      if (!(output >= 0 && output < pageCount))
        throw new Error(`Group ${g} references an unknown page`);
      if (sources[output] >= 0) throw new Error(`Page ${output} is produced by two groups`);
      sources[output] = g;
      outputs[at++] = output;
    }
  }
  for (const root of structure.roots)
    if (!(root >= 0 && root < pageCount && owners[root] < 0))
      throw new Error('Invalid structure root');
  return {
    groupCount,
    childOffsets,
    children,
    outputOffsets,
    outputs,
    sources,
    owners,
    error,
    sphere,
    roots: structure.roots,
  };
}
