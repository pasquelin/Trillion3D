/**
 * THE FRONT DEPTH CARRIED (`frontDepth.ts`): the depth the last image's transparents wrote, moved to
 * this image's pixels and folded into the Hi-Z's front layer before the image's reflections read it.
 */
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { FRONT_DEPTH_PASS } from '../stage/passLabels.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { FRONT_LABEL } from './frontTarget.ts'
import type { ScreenReflection } from './gpu.ts'
import type { ReflectionPipelines } from './reflectionPipelines.ts'

const { min } = Math

/**
 * The front depth the transparents of the last image wrote, carried to this image's pixels when
 * there is one, before the image's reflections, in one compute pass: the scatter over the rectangle
 * they wrote, then the boxes (`frontBox`) and the fold over this image's and the last one's
 * destination boxes (`frontFold`), which moves the carried words into the front layer `folded` and
 * leaves the buffer at zero. A texture that held a depth is cleared by the image after, once: its
 * box is the last one there.
 */
export function encodeFrontDepth(
  encoder: GPUCommandEncoder,
  reflection: Pick<ScreenReflection, 'device' | 'uniform' | 'front' | 'radiance'>,
  stages: Pick<
    ReflectionPipelines,
    'frontLayout' | 'frontPipeline' | 'frontFoldPipeline' | 'frontBoxLayout' | 'frontBoxPipeline'
  >,
  folded: GPUTextureView,
) {
  const { front, device } = reflection,
    { carried } = front
  // A front layer this front depth never folded into may hold another's — a reflection remade over
  // the same pyramid —: cleared once, before any fold reads or writes it.
  if (front.target !== folded) {
    encoder
      .beginRenderPass({
        label: FRONT_LABEL,
        colorAttachments: [
          { view: folded, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ],
      })
      .end()
    front.target = folded
  }
  const carries = front.fresh
  if (!carried || (!carries && !front.held)) return
  const { groups } = front,
    { next } = groups.identity
  next[0] = stages.frontLayout
  next[1] = stages.frontBoxLayout
  next[2] = reflection.uniform
  next[3] = front.view
  next[4] = folded
  next.length = 5
  if (groups.identity.moved() || !groups.group || !groups.boxGroup) {
    const scatterGroup = (rect: GPUBuffer) =>
      device.createBindGroup({
        label: FRONT_LABEL,
        layout: stages.frontLayout,
        entries: sequentialEntries([
          { buffer: reflection.uniform },
          front.view,
          { buffer: carried.buffer },
          { buffer: rect },
          { buffer: carried.box },
          folded,
        ]),
      })
    groups.group = scatterGroup(carried.rect)
    groups.waterGroup = scatterGroup(carried.waterRect)
    groups.boxGroup = device.createBindGroup({
      label: FRONT_LABEL,
      layout: stages.frontBoxLayout,
      entries: sequentialEntries([{ buffer: carried.box }, { buffer: carried.args }]),
    })
  }
  const { group, boxGroup } = groups
  const pass = encoder.beginComputePass({ label: FRONT_DEPTH_PASS })
  if (carries && front.water) {
    // The water's rectangle and workgroups, as the GPU wrote them: none when no water drew.
    pass.setPipeline(stages.frontPipeline)
    pass.setBindGroup(0, groups.waterGroup!)
    pass.dispatchWorkgroupsIndirect(carried.waterArgs, 0)
  } else if (carries) {
    const [width, height] = reflection.radiance.held.size,
      { rect, scattered } = front
    const x0 = min(rect[0], width),
      y0 = min(rect[1], height),
      x1 = min(rect[2], width),
      y1 = min(rect[3], height)
    scattered[0] = x0
    scattered[1] = y0
    scattered[2] = x1
    scattered[3] = y1
    writeChanged(device, carried.rect, scattered, 0, 4)
    if (x1 > x0 && y1 > y0) {
      pass.setPipeline(stages.frontPipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(ceilDiv(x1 - x0, REFLECTION_SIDE), ceilDiv(y1 - y0, REFLECTION_SIDE))
    }
  }
  pass.setPipeline(stages.frontBoxPipeline)
  pass.setBindGroup(0, boxGroup)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(stages.frontFoldPipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroupsIndirect(carried.args, 0)
  pass.end()
  front.held = carries
  front.fresh = false
}
