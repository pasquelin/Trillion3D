import { VERDICT } from '../webgpu/blend/verdictLayout.ts'
import type { FrontDepth } from './frontDepth.ts'

/** The attachment of a transparent pass for the front depth: the image's first such pass clears
 *  it. A blend pass writes over the whole target; the `water` pass within the rectangle the GPU
 *  wrote, which the next image's scatter reads there while no other pass wrote (`frontFromWater`). */
export function frontAttachment(front: FrontDepth, water = false) {
  const first = !front.fresh,
    to = front.rect
  front.fresh = true
  front.attachment.loadOp = first ? 'clear' : 'load'
  front.water = water && (first || front.water)
  if (!water) for (let k = 0; k < 4; k++) to[k] = k < 2 ? 0 : Infinity
  return front.attachment
}

/** After the water pass: its rectangle and the scatter's workgroups, from the `verdict` the GPU
 *  wrote them in (`../webgpu/water/argsWgsl.ts`), where the next image's scatter reads them — when
 *  the water was the image's only transparent pass. The CPU never knows the rectangle. */
export function frontFromWater(encoder: GPUCommandEncoder, front: FrontDepth, verdict: GPUBuffer) {
  const { carried } = front
  if (!front.water || !carried) return
  encoder.copyBufferToBuffer(
    verdict,
    VERDICT.rect * 4,
    carried.waterRect,
    0,
    carried.waterRect.size,
  )
  encoder.copyBufferToBuffer(
    verdict,
    VERDICT.frontArgs * 4,
    carried.waterArgs,
    0,
    carried.waterArgs.size,
  )
}
