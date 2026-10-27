import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { bufferEntries } from '../gpu/core/computeBindings.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import type { HairGroupGpu } from './groupResources.ts'
import { TANGENT_WGSL } from './tangentWgsl.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

const tangentKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}tangents`,
  TANGENT_WGSL,
  'hairTangents',
)

/**
 * Writes the tangents of `group` in `pass`, once: nothing while the program compiles, nothing for a
 * group already written. Returns whether the group's tangents are written (by this pass, which the
 * device runs in order before any pass that reads them).
 */
export function encodeHairTangents(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  group: HairGroupGpu,
) {
  if (group.tangentsWritten) return true
  const pipeline = tangentKernel(device).get()
  if (!pipeline) return false
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bufferEntries([group.points, group.tangents]),
    }),
  )
  dispatchRows(pass, ceilDiv(group.pointCount, WORKGROUP_THREADS))
  group.tangentsWritten = true
  return true
}
