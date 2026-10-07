import { DAG_ARGS } from './shader/armWgsl.ts'
import { dispatchGrid, groupWidth } from './shader/gridWgsl.ts'
import { SELECTION_WORKGROUP as WORKGROUP } from '../core/selection.ts'
import type { DagView } from './encode.ts'

const DAG_PASS: GPUComputePassDescriptor = { label: 'Trillion3D DAG selection' }

/** Each kept list's argument record (`shader/armWgsl.ts`). */
const LIST_ARGS = [DAG_ARGS.list0, DAG_ARGS.list1]

/**
 * The cut's difference against the snapshot last copied, then this one kept in its place
 * (`shader/differenceWgsl.ts`): what a dispatch that copies a snapshot encodes before the copy,
 * in the cut's last pass when it cuts. Each list's kernels bind its ranks where the cut binds
 * `work` (`rankGroups`): both differences, then both lists' exits, then both keeps. A difference
 * or a keep is as long as its list: the kernels that know the lengths armed their groups
 * (`dagSortRequests`, `dagDrawPrefix`), copied here by the arming kernel, in the pass. An exit is
 * as long as the readout's list cap, the kept length known on the GPU alone, a thread past it
 * leaving at once. The cut's own group is bound again behind them.
 */
export function encodeDifference(pass: GPUComputePassEncoder, resources: DagView) {
  pass.setPipeline(resources.armPipeline)
  pass.setBindGroup(0, resources.armGroup)
  pass.dispatchWorkgroups(1)
  const listed = (pipelines: readonly GPUComputePipeline[]) =>
    pipelines.forEach((pipeline, l) => {
      pass.setBindGroup(0, resources.rankGroups[l])
      pass.setPipeline(pipeline)
      pass.dispatchWorkgroupsIndirect(resources.dispatchArgs, LIST_ARGS[l])
    })
  listed(resources.differencePipelines)
  const [x, y] = dispatchGrid(
    Math.max(1, Math.ceil(resources.listCap / WORKGROUP)),
    groupWidth(resources.device?.limits),
  )
  resources.exitPipelines.forEach((pipeline, l) => {
    pass.setBindGroup(0, resources.rankGroups[l])
    pass.setPipeline(pipeline)
    pass.dispatchWorkgroups(x, y)
  })
  listed(resources.keepPipelines)
  pass.setBindGroup(0, resources.ranges[0].bindGroup)
}

/** A dispatch that copies the snapshot in hand without cutting: its difference in a pass of its
 *  own, on each list's group (`rankGroups`). */
export function encodeDagDifference(encoder: GPUCommandEncoder, resources: DagView) {
  const pass = encoder.beginComputePass(DAG_PASS)
  encodeDifference(pass, resources)
  pass.end()
}
