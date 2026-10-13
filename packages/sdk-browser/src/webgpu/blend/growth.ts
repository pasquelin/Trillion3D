/**
 * THE TRANSPARENT PASS TAKES THE BLENDED AND TRANSMISSIVE COPIES OF A SOURCE ADDED TO THE SESSION
 * (`addPlacements`). What the open built once for the copies it held — the items, the volumes, the
 * table of transparent clusters and the compaction that filters it, the occlusion test, the
 * kernels' buffers — is made for the copies a session gains by the open's own functions, run on
 * them: their items follow the held ones (`prepareWebgpuBlend`), their entries follow the table's
 * (`TransparentTable.append`), the buffers a full table outgrew are made once as long
 * (`TransparentCompaction.grow`, `growVolumes`, the occlusion's `grow`), and the kernels, compiled
 * once, are mounted again over the items (`mountBlendResources`).
 *
 * A session opened without a transmissive surface is granted the water pass by the open's own
 * function when the first copies that bring one arrive (`grantWater`).
 *
 * Two steps, as the roots of the same source join the cut: the kernels the session never needed
 * are compiled before (`prepareBlendGrowth`, which waits for the device), and the items and tables
 * join in one step between two images, once the roots hold their packed ranks (`growBlend`).
 *
 * Cost of one source of B' items bringing E' table entries: O(B' + E') for the items, the table and
 * its compaction, the buffers sized by the entries copied once when a doubling is due (amortised
 * O(1) an entry); the blended items the session holds are written once more (O(B) words) with the
 * scene buffers mounted again over them.
 */
import type { BlendCopy } from '../../cluster/blendCopyContract.ts'
import type { PageRec, ClusterRoot } from '../../page/selection/types.ts'
import { loadUnpaged } from '../core/positions.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import {
  prepareTransparentOcclusion,
  growTransparentOcclusion,
} from '../transparent/occlusionHost.ts'
import { createTransparentCompaction } from '../transparent/compact.ts'
import { updateTransparentSpan } from '../transparent/spans.ts'
import { growVolumes } from '../transparent/transmission.ts'
import { buildBlendPipelines } from '../pages/prepare/visibilitySteps.ts'
import { prepareWebgpuBlend } from './prepare.ts'
import { mountBlendResources, prepareBlendKernels } from './resources.ts'

type Root = ClusterRoot<PageRec>

/** Why the transparent pass cannot take a surface where the session stands, said by name; none
 *  when it can. */
export function blendRefusal(rt: WebgpuPagesRuntime) {
  return rt.vis.blendPipelines ? undefined : 'a session whose blend pipelines were refused'
}

const transmits = (copy: BlendCopy) => copy.surface.transmission > 0

/**
 * The water pass of a session opened without a transmissive surface, made for the first copies
 * that bring one by the open's own function (`buildBlendPipelines`): the blend programs are built
 * again with the water stage in their module, and the pass is made on them. Its targets — the
 * backdrop, the display colour, the emission layer — are asked of the frame as any target is
 * (`holdsWater`, `targetsFit`), and the copies join once these are in place (`waterHeld`). False
 * when the device refuses the pass.
 */
async function grantWater(rt: WebgpuPagesRuntime, device: GPUDevice, copies: readonly BlendCopy[]) {
  const { vis, blendState } = rt,
    items = [
      ...blendState.blendGpu,
      ...copies.map((copy) => ({ surface: copy.surface, transmissive: transmits(copy) })),
    ]
  const built = await buildBlendPipelines(rt, device, items, vis.blendBindGroupLayout)
  if (!built?.water) return false
  // Granted meanwhile by another source: that pass stays.
  if (blendState.water) {
    built.water.frame.dispose()
    return true
  }
  vis.blendPipelines = built.blendPipelines
  blendState.water = built.water
  blendState.waterGranted = true
  return true
}

/** Whether the copies wait for the water pass's targets and the classes that write the emission
 *  layer, which it draws over: the frame asks them as it asks any (`askFramePipelines`). */
export const waitsForWater = (rt: WebgpuPagesRuntime, copies: readonly BlendCopy[]) =>
  copies.some(transmits) && !(rt.gpu.backdrop?.active && rt.vis.writesEmissiveAo)

/** Whether the copies wait for the front depth the blend pass writes: the reflection's target, a texel
 *  in a session opened without a blend (`createFrontDepth`), is remade full size by the frame's
 *  targets (`targetsFit`). */
export const waitsForFrontDepth = (rt: WebgpuPagesRuntime, copies: readonly BlendCopy[]) =>
  copies.length > 0 && !rt.gpu.reflection?.front.wanted

/** The compaction and the occlusion test being made for the first blended pages the session gains. */
const mounting = new WeakMap<WebgpuPagesRuntime, Promise<boolean>>()

/** The compaction, and the occlusion test over it, made on an empty table: the copies' entries
 *  join it with the rest (`growBlend`). False when the device refuses the kernels. */
function mountTransparent(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState } = rt
  let made = mounting.get(rt)
  if (!made) {
    made = (async () => {
      blendState.compaction ??= await createTransparentCompaction(device, blendState.table!)
      if (!blendState.compaction?.encode) return false
      if (!blendState.occlusion) await prepareTransparentOcclusion(rt, device)
      return true
    })().finally(() => mounting.delete(rt))
    mounting.set(rt, made)
  }
  return made
}

/**
 * What the copies need compiled before they join: their vertices (`loadUnpaged`), the kernels of
 * the transparent pass, and for blended pages the compaction and the occlusion test. False when the
 * device refuses a kernel, the source then being refused (the next opening is told by name).
 */
export async function prepareBlendGrowth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  copies: readonly BlendCopy[],
  pages: readonly PageRec[],
) {
  await loadUnpaged(pages, copies)
  await prepareBlendKernels(rt, device)
  // The blend pass writes a front depth a pixel: the reflection's front depth target is made for it before the
  // copies join (`sceneBlends`, `waitsForFrontDepth`).
  if (copies.length) rt.blendState.frontGranted = true
  if (copies.some(transmits) && !rt.blendState.water && !(await grantWater(rt, device, copies)))
    return false
  if (!copies.some((copy) => copy.userData.pagedBlend) || rt.blendState.compaction?.encode)
    return true
  return mountTransparent(rt, device)
}

/**
 * The copies join the pass: items, volumes, the table's entries for the pages of `roots` — ranked
 * from packed rank `base` on —, the compaction and the occlusion test made to hold them, and the
 * scene buffers over all of the items. One step, between two images.
 */
export function growBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  copies: readonly BlendCopy[],
  roots: readonly Root[],
  base: number,
) {
  const { blendState, gpu, setup } = rt,
    held = blendState.blendGpu.length
  blendState.transmissive = prepareWebgpuBlend(device, copies, gpu, blendState, setup.scene)
  growVolumes(rt, device)
  const { table } = blendState
  if (table) {
    const first = table.length
    table.append(roots, base, blendState.blendGpu.slice(held))
    // A page of an address the pool holds already is named by no arrival: its span is read from the
    // pool, as the arrival of a page would give it.
    for (let entry = first; entry < table.length; entry++) {
      const page = table.pageOfEntry[entry]
      if (page >= 0) updateTransparentSpan(rt, page, rt.layout.rows.offsetOf(page))
    }
    blendState.compaction?.grow()
    // The identity of the entries it gained is written at the next diagnostic image.
    blendState.diagnosticMode = undefined
    growTransparentOcclusion(rt)
  }
  mountBlendResources(rt, device)
}
