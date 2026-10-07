import type { SelectionSubmission } from '../core/selection.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'
import { viewWord } from './viewLayout.ts'
import { swapRegionsWord } from './shader/swapWgsl.ts'
import type { DagView } from './encode.ts'
import { holdSwap, saveRegionFor } from './swap.ts'

/** The camera block's region word (`swapRegions`): the host copy, then that one word of the
 *  buffer, nothing allocated. */
function writeRegions(resources: DagView, save: number, back: number) {
  const word = viewWord('swapRegions')
  resources.uniformWords[word] = swapRegionsWord(save, back)
  resources.device.queue.writeBuffer(resources.uniforms, word * 4, resources.uniformWords, word, 1)
}

/**
 * The mask handed to `view` without a cut, its region checked `restorable`: the journal in place
 * cleared — saved on the way when its owner's region does not hold it yet —, and `view`'s written
 * back with its flags, each dispatch as long as its journal. `out` keeps the lists it holds. Given
 * `shared`, the caller's command buffer: the swap is given back if it is dropped.
 */
export function encodeSwap(
  resources: DagView,
  view: number,
  shared?: GPUCommandEncoder,
): SelectionSubmission | undefined {
  const { swap, device } = resources,
    undo = holdSwap(swap, view)
  writeRegions(resources, saveRegionFor(swap, view), view - 1)
  const encoder = shared ?? device.createCommandEncoder()
  const pass = encoder.beginComputePass({ label: 'Trillion3D DAG mask swap' })
  const arm = () => {
    pass.setPipeline(resources.armPipeline)
    pass.setBindGroup(0, resources.armGroup)
    pass.dispatchWorkgroups(1)
    pass.setBindGroup(0, resources.ranges[0].bindGroup)
  }
  arm()
  pass.setPipeline(resources.clearDrawnPipeline)
  pass.dispatchWorkgroupsIndirect(resources.dispatchArgs, DAG_ARGS.drawn)
  arm()
  pass.setPipeline(resources.restorePipeline)
  pass.dispatchWorkgroupsIndirect(resources.dispatchArgs, DAG_ARGS.restore)
  pass.end()
  swap.owner = view
  swap.cut = swap.saved[view - 1]
  if (!shared) {
    device.queue.submit([encoder.finish()])
    return undefined
  }
  let settled = false
  return (submitted) => {
    if (!settled && !submitted) undo()
    settled = true
  }
}
