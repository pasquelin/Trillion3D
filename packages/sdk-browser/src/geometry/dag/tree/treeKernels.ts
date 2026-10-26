import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { LEAF_STRIDE_CONSTANT, PARENT_LEAF } from '../placement/placementTree.ts'

/**
 * A kernel that reads or writes the placement tree's leaves (`../../../placement/tree/treeLeavesWgsl.ts`,
 * `treeRefitWgsl.ts`), made once a device for each width of leaf (`leafStride`): the wide kernel
 * keeps the stride its text declares, the narrow one, for a cut whose packing names no group above
 * any instance's root, the box's alone. `parented` picks the one a cut binds.
 */
export function leafKernels(label: string, code: string) {
  const wide = autoKernel(label, code, 'main'),
    narrow = autoKernel(label, code, 'main', { [LEAF_STRIDE_CONSTANT]: PARENT_LEAF })
  return (parented: boolean) => (parented ? wide : narrow)
}
