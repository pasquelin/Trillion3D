import {
  BLEND_ITEM_WORDS,
  ITEM_FLAGS_WORD,
  ITEM_HLOD_PROXY,
  itemProxyBit,
  writeBlendItemRecord,
} from './items.ts'
import { refreshBlendPlan } from './plan.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { sameMatrixFloat32 } from '../../../../math/src/matrix/matrixElements.ts'
import { frontStageOf } from './frontStage.ts'

/**
 * Records and the encode plan, rebuilt after a scene change.
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
    blendState.lobed = false
    blendState.frontOutputs = 0
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
}

/** Every record written whole, the lobe switches derived from them, and what the front pass writes. */
function writeBlendRecords(rt: WebgpuPagesRuntime, queue: GPUQueue, buffer: GPUBuffer) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu,
    packed = blendState.itemPacked
  let lobed = false
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    item.lobed = writeBlendItemRecord(packed, blendState.itemInts, i, item, vis)
    lobed ||= item.lobed
  }
  blendState.lobed = lobed
  blendState.frontOutputs = frontStageOf(items)
  queue.writeBuffer(buffer, 0, packed.buffer, 0, packed.byteLength)
}

/** The poses alone: each item whose matrix or HLOD 0 actor bit moved writes them, and the span from
 *  the first moved to the last is sent — none when nothing moved. */
function writeBlendPoses(
  blendState: WebgpuPagesRuntime['blendState'],
  queue: GPUQueue,
  buffer: GPUBuffer,
) {
  const items = blendState.blendGpu,
    packed = blendState.itemPacked
  let first = -1,
    last = -1
  const ints = blendState.itemInts
  for (let i = 0; i < items.length; i++) {
    const pose = items[i].matrix.elements,
      base = i * BLEND_ITEM_WORDS,
      flags = base + ITEM_FLAGS_WORD
    // Its placement drawn as its cell's HLOD 0 actor or as itself (`ITEM_HLOD_PROXY`), beside it.
    const proxied = ((ints[flags] & ~ITEM_HLOD_PROXY) | itemProxyBit(items[i])) >>> 0
    const still = sameMatrixFloat32(packed, pose, base)
    if (still && proxied === ints[flags]) continue
    packed.set(pose, base)
    ints[flags] = proxied
    if (first < 0) first = i
    last = i
  }
  if (first < 0) return
  const at = first * BLEND_ITEM_WORDS * 4
  const bytes = (last - first + 1) * BLEND_ITEM_WORDS * 4
  queue.writeBuffer(buffer, at, packed.buffer, at, bytes)
}
