import { BLEND_ITEM_WORDS, writeBlendItemRecord } from './items.ts'
import { refreshBlendPlan } from './plan.ts'
import { writeVolumeRecords } from '../transparent/transmission.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { sameMatrixFloat32 } from '../../../../math/src/matrix/matrixElements.ts'

/**
 * Records, volumes and the encode plan, rebuilt after a scene change.
 *
 * This is the ONLY remaining loop over items, and a camera that moves does not trigger it: it
 * only restarts on a matrix move or a resource mount. With `posesOnly` — a frame whose scene moved
 * (`../pages/render/render.ts`) —, only the poses can have moved: a record holds none of its
 * surface's values, which its record in the material table does (`../material/materialTable.ts`),
 * and each item compares its sixteen matrix words, the moved ones sent as one span
 * (`writeBlendPoses`). What a record reads besides — its flags, its lobe and deformation words —
 * moves with a surface's summary or a texture's sampling (a whole rewrite, the render's
 * `followSceneInputs`) or a new scene (`prepare`).
 */
export function refreshBlendScene(rt: WebgpuPagesRuntime, device: GPUDevice, posesOnly = false) {
  const { blendState, vis } = rt,
    buffer = blendState.itemBuffer
  if (!buffer || !blendState.blendGpu.length) {
    // No item left: no lobe either, so the lobes target and the lobed programs are dropped too.
    blendState.lobed = blendState.waterLobed = false
    return
  }
  if (posesOnly) writeBlendPoses(blendState, device.queue, buffer)
  else writeBlendRecords(rt, device.queue, buffer)
  refreshBlendPlan(blendState)
  if (posesOnly) return
  // A blending written on a surface starts its compile here, off the frame (`reach.ts`).
  vis.blendPipelines?.reach({
    modes: blendState.planModes,
    filtered: blendState.filtersDisplay,
  })
  writeVolumeRecords(rt, device)
}

/** Every record written whole, and the lobe switches derived from them. */
function writeBlendRecords(rt: WebgpuPagesRuntime, queue: GPUQueue, buffer: GPUBuffer) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu,
    packed = blendState.itemPacked
  let lobed = false,
    waterLobed = false
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    item.lobed = writeBlendItemRecord(packed, blendState.itemInts, i, item, vis)
    lobed ||= item.lobed
    waterLobed ||= item.lobed && !!item.transmissive
  }
  blendState.lobed = lobed
  blendState.waterLobed = waterLobed
  // A transmissive surface that brings a lobe: the water's lobed stage compiles, off the frame, the
  // frames held until it lands (`lobedStage.ts`).
  if (waterLobed) blendState.water?.lobed.ask()
  queue.writeBuffer(buffer, 0, packed.buffer, 0, packed.byteLength)
}

/** The poses alone: each item whose matrix moved writes its sixteen words, and the span from the
 *  first moved to the last is sent — none when no pose moved. */
function writeBlendPoses(
  blendState: WebgpuPagesRuntime['blendState'],
  queue: GPUQueue,
  buffer: GPUBuffer,
) {
  const items = blendState.blendGpu,
    packed = blendState.itemPacked
  let first = -1,
    last = -1
  for (let i = 0; i < items.length; i++) {
    const pose = items[i].matrix.elements,
      base = i * BLEND_ITEM_WORDS
    if (sameMatrixFloat32(packed, pose, base)) continue
    packed.set(pose, base)
    if (first < 0) first = i
    last = i
  }
  if (first < 0) return
  const at = first * BLEND_ITEM_WORDS * 4
  const bytes = (last - first + 1) * BLEND_ITEM_WORDS * 4
  queue.writeBuffer(buffer, at, packed.buffer, at, bytes)
}
