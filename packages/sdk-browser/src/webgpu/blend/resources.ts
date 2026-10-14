import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { BLEND_ITEM_WORDS } from './items.ts'
import { refreshBlendScene } from './sceneRefresh.ts'
import { buildBlendStatics } from './statics.ts'
import { mountBlendExpand } from './expand.ts'
import { compileBlendExpand, EXPANSION_REFUSED } from './expandKernels.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { EXPAND_PASSES, planWords, scratchWords, slotCapacity } from './planLayout.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { uniformStride } from '../../residency/pools.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'

/**
 * Everything the transparent pass holds of the SCENE, mounted at the open (`mountBlendResources`):
 * the item records, the view uniform, the indirect arguments and the GPU frustum that writes them.
 *
 * Nothing here depends on the camera. What depends on the scene — matrices, materials — is redone
 * by `refreshBlendScene`, and only when the scene has moved.
 */
export async function prepareBlendResources(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState } = rt
  if (!blendState.blendGpu.length) return
  await prepareBlendKernels(rt, device)
  // The device refuses what it cannot hold by name, as it refuses the kernels.
  const mounted = await validated(device, () => (mountBlendResources(rt, device), true))
  if (mounted) return
  disposeBlendResources(blendState)
  throw new Error(EXPANSION_REFUSED)
}

/** The kernels of the transparent pass, compiled once for the session's life. */
export async function prepareBlendKernels(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState } = rt
  blendState.kernels ??= await compileBlendExpand(device)
}

/**
 * The scene buffers of the blended items the session holds, mounted on the compiled kernels. The
 * open mounts them once; a session that gains blended items mounts them again over all of its
 * items (`growBlend`): the expansion is made again, and each scene buffer is the one held where it
 * holds the items, else grown by the engine's one rule (`sizedBuffer`), the old one retired; the
 * groups that cited a buffer replaced are voided by their identity at the next pass.
 */
export function mountBlendResources(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu
  blendState.expand?.dispose()
  blendState.expand = undefined
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
  // The verdict's buffers are new: no count read back before holds for them.
  blendState.verdictEpoch++
  refreshBlendScene(rt, device)
  blendState.expandedBuffer = sizedBuffer(
    device,
    blendState.expandedBuffer,
    blendState.instanceCapacity * 8,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D blend expanded instances',
  )
  blendState.argsBuffer = sizedBuffer(
    device,
    blendState.argsBuffer,
    slotCapacity(entries) * 16 * EXPAND_PASSES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    'Trillion3D blend indirect arguments',
  )
  blendState.expand = mountBlendExpand(
    device,
    blendState.kernels!,
    {
      items: items.length,
      waters: blendState.transmissive,
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
  blendState.itemBuffer = sizedBuffer(
    device,
    blendState.itemBuffer,
    count * BLEND_ITEM_WORDS * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D blend item records',
  )
  blendState.viewBuffer = sizedBuffer(
    device,
    blendState.viewBuffer,
    BLEND_VIEW_SIZE,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'Trillion3D blend view uniform',
  )
}

/** Releases the transparent pass's scene buffers, at the session's end or a refused mount; the
 *  groups that cited them are voided by their identity at the next pass. */
export function disposeBlendResources(blendState: WebgpuPagesRuntime['blendState']) {
  blendState.expand?.dispose()
  blendState.expand = undefined
  for (const buffer of ['expandedBuffer', 'argsBuffer', 'itemBuffer', 'viewBuffer'] as const) {
    blendState[buffer]?.destroy()
    blendState[buffer] = undefined
  }
}
