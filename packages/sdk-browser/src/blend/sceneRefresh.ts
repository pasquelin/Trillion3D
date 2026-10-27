import {
  BLEND_ITEM_WORDS,
  ITEM_FLAGS_WORD,
  ITEM_HLOD,
  ITEM_NEEDS,
  itemHlodBits,
  writeBlendItemRecord,
} from './items.ts'
import { refreshBlendPlan } from './plan/plan.ts'
import { itemFilterWord } from './expand/expansionViews.ts'
import { forgetViews } from './expand/viewRoom.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { sameMatrixFloat32 } from '../../../math/src/matrix/matrixElements.ts'
import { frontStageOf } from './frontStage.ts'
import { wantsResponsive } from '../frame/prepare/responsiveTarget.ts'

/**
 * Records and the encode plan, rebuilt after a scene change.
 *
 * This is the ONLY remaining loop over items, and a camera that moves does not trigger it: it
 * only restarts on a matrix move or a resource mount. With `posesOnly` — a frame whose scene moved
 * (`../frame/render/render.ts`) —, only the poses can have moved: a record holds none of its
 * surface's values, which its record in the material table does (`../materials/table/materialTable.ts`),
 * and each item compares its sixteen matrix words, the moved ones sent as one span
 * (`writeBlendPoses`). What a record reads besides — its flags, its lobe and deformation words —
 * moves with a surface's summary or a texture's sampling (a whole rewrite, the render's
 * `followSceneInputs`) or a new scene (`prepare`).
 */
export function refreshBlendScene(rt: WebgpuPagesRuntime, device: GPUDevice, posesOnly = false) {
  const { blendState, vis } = rt,
    buffer = blendState.itemBuffer
  if (!buffer || !blendState.blendGpu.length) {
    // No item left: no lobe either, so the lobes target and the lobed programs are dropped too,
    // and no responsiveness.
    blendState.lobed = false
    blendState.responsive = false
    blendState.channelled = false
    blendState.translucencyPasses = 0
    blendState.frontOutputs = 0
    return
  }
  if (posesOnly) writeBlendPoses(blendState, device.queue, buffer)
  else writeBlendRecords(rt, device.queue, buffer)
  refreshBlendPlan(blendState)
  if (posesOnly) return
  // A blending or a responsiveness written on a surface starts its compile here, off the frame
  // (`reach.ts`).
  vis.blendPipelines?.reach({
    variants: blendState.planVariants,
    responsive: wantsResponsive(rt),
    chromatic: blendState.chromatic,
    filtered: blendState.filtersDisplay,
  })
}

/** Every record written whole, the lobe and responsive switches derived from them, and what the
 *  front pass writes. */
function writeBlendRecords(rt: WebgpuPagesRuntime, queue: GPUQueue, buffer: GPUBuffer) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu,
    packed = blendState.itemPacked
  let lobed = false,
    responsive = false,
    channelled = false,
    passes = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const needs = writeBlendItemRecord(packed, blendState.itemInts, i, item, vis)
    item.lobed = (needs & ITEM_NEEDS.lobed) !== 0
    lobed ||= item.lobed
    responsive ||= (needs & ITEM_NEEDS.responsive) !== 0
    channelled ||= (needs & ITEM_NEEDS.channelled) !== 0
    const pass = needs >> ITEM_NEEDS.passShift
    passes |= 1 << pass
    // The words the expansion's views filter the item by: its pass and its responsiveness (`expansionViews.ts`).
    blendState.drawsPacked[i * 4 + 3] = itemFilterWord(pass, (needs & ITEM_NEEDS.responsive) !== 0)
  }
  blendState.expand?.uploadDraws(blendState.drawsPacked)
  forgetViews(blendState)
  blendState.lobed = lobed
  blendState.responsive = responsive
  blendState.channelled = channelled
  blendState.translucencyPasses = passes
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
    // The HLOD index its placement draws as (`ITEM_HLOD`), beside it.
    const proxied =
      ((ints[flags] & ~(ITEM_HLOD.mask << ITEM_HLOD.shift)) | itemHlodBits(items[i])) >>> 0
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
