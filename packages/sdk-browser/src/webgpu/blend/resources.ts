import { BLEND_ITEM_WORDS, writeBlendItemRecord } from './items.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { buildBlendStatics, refreshBlendPlan } from './plan.ts'
import { createBlendExpand } from './expand.ts'
import { EXPAND_PASSES, planWords, scratchWords, slotCapacity } from './planLayout.ts'
import { writeKeyRecords } from './keyRecords.ts'
import { writeVolumeRecords } from '../transparent/transmission.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { materialEpoch } from '../pages/io/refreshMaterials.ts'
import { uniformStride } from '../../residency/pools.ts'

/**
 * Everything the transparent pass holds of the SCENE, mounted once: the item records, the view
 * uniform, the indirect arguments and the GPU frustum that writes them.
 *
 * Nothing here depends on the camera. What depends on the scene — matrices, materials — is redone
 * by `refreshBlendScene`, and only when the scene has moved.
 */
export async function prepareBlendResources(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu
  if (!items.length) return
  // `prepare()` is public and can be called again without going through dispose: everything the
  // previous prepare mounted is released here, expansion included. Bind groups that cited those
  // buffers fall with them.
  disposeBlendResources(blendState)
  // A paged item without quantized pages reads the concatenated geometry, the very same as the
  // opaque pass: its first vertex there is the block of its source geometry.
  for (const item of items)
    item.vertexBase = item.paged
      ? (vis.geometryBlocks.get(item.sourceGeometry.attributes)?.vertexBase ?? 0)
      : item.deformOutput
        ? item.vertexBase
        : 0
  // The order's step words are laid at the device's alignment, as the kernels' buffers.
  buildBlendStatics(blendState, uniformStride(device.limits))
  // The scene's transparent list IS the draw list: what an image takes out of it, it takes out
  // with a zero instance count, and the readbacks keep naming the scene's items.
  blendState.visibleBlend.length = 0
  for (const item of items) blendState.visibleBlend.push(item)
  allocateBlendRecords(blendState, device)
  // The two outputs of expansion: the instance list the shader reads at the rank the vertex index
  // gives it, and one indirect argument per slice. They belong to the scene.
  const entries = blendState.maxPlanEntries
  refreshBlendScene(rt, device)
  blendState.expandedBuffer = device.createBuffer({
    label: 'Trillion3D blend expanded instances',
    size: blendState.instanceCapacity * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  blendState.argsBuffer = device.createBuffer({
    label: 'Trillion3D blend indirect arguments',
    size: slotCapacity(entries) * 16 * EXPAND_PASSES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  blendState.expand = await createBlendExpand(
    device,
    {
      items: items.length,
      entries,
      planWords: planWords(entries),
      scratchWords: scratchWords(entries),
    },
    {
      counts: blendState.compaction?.indirectBuffer,
      clusters: blendState.compaction?.instanceBuffer,
    },
    { expanded: blendState.expandedBuffer, args: blendState.argsBuffer },
  )
  blendState.expand.uploadDraws(blendState.drawsPacked)
}

/** The item records, host side and on the device, and the view uniform: one scene buffer, one
 *  frame buffer. */
function allocateBlendRecords(blendState: WebgpuPagesRuntime['blendState'], device: GPUDevice) {
  const count = blendState.blendGpu.length
  blendState.itemPacked = new Float32Array(count * BLEND_ITEM_WORDS)
  blendState.itemInts = new Uint32Array(blendState.itemPacked.buffer)
  blendState.itemBuffer = device.createBuffer({
    label: 'Trillion3D blend item records',
    size: count * BLEND_ITEM_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  blendState.viewBuffer = device.createBuffer({
    label: 'Trillion3D blend view uniform',
    size: BLEND_VIEW_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
}

/** Releases the transparent pass's scene buffers; the groups that cited them are voided by their
 *  identity at the next pass. */
export function disposeBlendResources(blendState: WebgpuPagesRuntime['blendState']) {
  blendState.expand?.dispose()
  blendState.expand = undefined
  for (const buffer of ['expandedBuffer', 'argsBuffer', 'itemBuffer', 'viewBuffer'] as const) {
    blendState[buffer]?.destroy()
    blendState[buffer] = undefined
  }
}

/**
 * Records, volumes and the encode plan, rebuilt after a scene change.
 *
 * This is the ONLY remaining loop over items, and a camera that moves does not trigger it: it
 * only restarts on a matrix move or a resource mount. With `posesOnly` — a frame whose scene moved
 * (`../pages/render/render.ts`) —, the records are written whole only when a material's values
 * moved since they last were (`materialEpoch`): otherwise only the poses can have, and each item
 * compares its sixteen matrix words, the moved ones sent as one span (`writeBlendPoses`). What a
 * record reads besides — material, flags, maps, its lobe and deformation words — moves with a
 * material, a texture's sampling (a whole rewrite, `followSampling`) or a new scene (`prepare`).
 */
export function refreshBlendScene(rt: WebgpuPagesRuntime, device: GPUDevice, posesOnly = false) {
  const { blendState, vis } = rt,
    buffer = blendState.itemBuffer
  if (!buffer || !blendState.blendGpu.length) {
    // No item left: no lobe either, so the lobes target and the lobed programs are dropped too.
    blendState.lobed = blendState.waterLobed = false
    return
  }
  const epoch = materialEpoch(rt),
    whole = !posesOnly || blendState.recordEpoch !== epoch
  if (whole) writeBlendRecords(rt, device.queue, buffer, epoch)
  else writeBlendPoses(blendState, device.queue, buffer)
  refreshBlendPlan(blendState)
  if (!whole) return
  // A blending written on a surface starts its compile here, off the frame (`reach.ts`).
  vis.blendPipelines?.reach({
    modes: blendState.planModes,
    filtered: blendState.filtersDisplay,
  })
  writeVolumeRecords(rt, device)
}

/** Every record written whole, and the lobe switches derived from them. */
function writeBlendRecords(
  rt: WebgpuPagesRuntime,
  queue: GPUQueue,
  buffer: GPUBuffer,
  epoch: number,
) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu,
    packed = blendState.itemPacked
  let lobed = false,
    waterLobed = false
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    item.lobed = writeBlendItemRecord(packed, blendState.itemInts, i, item, vis) !== 0
    lobed ||= item.lobed
    waterLobed ||= item.lobed && !!item.transmissive
  }
  blendState.lobed = lobed
  blendState.waterLobed = waterLobed
  blendState.recordEpoch = epoch
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
    let k = 0
    while (k < 16 && packed[base + k] === Math.fround(pose[k])) k++
    if (k === 16) continue
    packed.set(pose, base)
    if (first < 0) first = i
    last = i
  }
  if (first < 0) return
  const at = first * BLEND_ITEM_WORDS * 4
  const bytes = (last - first + 1) * BLEND_ITEM_WORDS * 4
  queue.writeBuffer(buffer, at, packed.buffer, at, bytes)
}

/**
 * What the image asks of the kernels: the plan when it moved, the frustum verdict when it moved,
 * the frame data, then for each pass its order and its expansion, chained in ONE compute pass.
 *
 * Dispatches of the same compute pass are ordered and see the previous writes: blend can therefore
 * hand its work memory back to transmission, whose instances and arguments live in their own
 * regions.
 */
export function encodeBlendExpansion(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { blendState } = rt,
    expand = blendState.expand,
    { runCount, seeds } = blendState
  if (!expand) return
  // No slot to draw: a frame without an eye paints nothing (`order.ts`).
  if (!runCount[0] && !runCount[1]) return
  if (blendState.planMoved) {
    expand.uploadPlan({
      passes: seeds.map((passSeeds, pass) => ({
        seeds: passSeeds,
        counts: {
          entries: passSeeds.length,
          runs: blendState.slotCounts[pass],
          instanceBase: blendState.instanceBase[pass],
        },
        region: blendState.planRegions[pass],
      })),
      scene: blendState,
      stepWords: blendState.orderStepWords,
      keyWords: writeKeyRecords(blendState),
    })
    blendState.planMoved = false
  }
  if (blendState.keepMoved) {
    expand.uploadKeep(blendState.keepPacked)
    blendState.keepMoved = false
  }
  expand.uploadFrame(blendState.frameWords, blendState.frameLayout.words)
  const pass = encoder.beginComputePass({ label: 'Trillion3D blend order and expansion' })
  for (let slice = 0; slice < seeds.length; slice++)
    if (runCount[slice])
      expand.encode(pass, slice, blendState.orderSteps[slice], {
        entries: seeds[slice].length,
        runs: runCount[slice],
      })
  pass.end()
}
