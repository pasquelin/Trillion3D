/**
 * THE TRANSPARENT PASS TAKES THE BLENDED AND TRANSMISSIVE COPIES OF A SOURCE ADDED TO THE SESSION
 * (`addPlacements`). What the open built once for the copies it held — the items, the
 * table of transparent clusters and the compaction that filters it, the occlusion test, the
 * kernels' buffers — is made for the copies a session gains by the open's own functions, run on
 * them: their items follow the held ones (`prepareWebgpuBlend`), their entries follow the table's
 * (`TransparentTable.append`), the buffers a full table outgrew are made once as long
 * (`TransparentCompaction.grow`, the occlusion's `grow`), and the kernels, compiled
 * once, are mounted again over the items (`mountBlendResources`).
 *
 * A session opened without a transmissive surface is granted the transmissive stages by the open's
 * own function when the first copies that bring one arrive (`grantTransmission`).
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
import type { BlendCopy } from '../geometry/cluster/blendCopyContract.ts'
import type { PageRec, ClusterRoot } from '../geometry/selection/types.ts'
import { loadUnpaged } from '../gpu/core/positions.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import {
  prepareTransparentOcclusion,
  growTransparentOcclusion,
} from './transparent/occlusionHost.ts'
import { createTransparentCompaction } from './transparent/compact.ts'
import { updateTransparentSpan } from './transparent/spans.ts'
import { buildBlendPipelines } from '../frame/prepare/visibilitySteps.ts'
import { prepareWebgpuBlend } from './prepare.ts'
import { graphProgramsOf } from './graphWgsl.ts'
import {
  cloudFogOf,
  fogVertexOf,
  coversTranslucentShadow,
  translucentShadowOf,
} from './pipelines.ts'
import { translucencyVolumeOf } from '../materials/surface/blendLightSource.ts'
import { readSingleLayerWaterSetting } from '../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { composeItems } from '../placement/compose/gpuCompose.ts'
import { mountBlendResources, prepareBlendKernels } from './resources.ts'

/** Why the transparent pass cannot take a surface where the session stands, said by name; none
 *  when it can. */
export function blendRefusal(rt: WebgpuPagesRuntime) {
  return rt.vis.blendPipelines ? undefined : 'a session whose blend pipelines were refused'
}

const transmits = (copy: BlendCopy) => copy.surface.transmission > 0

/** What the blend's programs are built over for the copies a session gains: the items it holds, and
 *  theirs. */
const itemsOf = (rt: WebgpuPagesRuntime, copies: readonly BlendCopy[]) => [
  ...rt.blendState.blendGpu,
  ...copies.map((copy) => ({ surface: copy.surface, transmissive: transmits(copy) })),
]

/** The blend programs built again over `items`, in the feedback variant in place when they land: one
 *  swapped meanwhile — a texture came or went (`followFeedback`) — builds them again, or their
 *  pipelines would not match the pass. None when the device refuses them. */
async function buildGranted(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  items: ReturnType<typeof itemsOf>,
) {
  const { vis } = rt
  let built: Awaited<ReturnType<typeof buildBlendPipelines>>, feedback: boolean
  do {
    feedback = vis.writesFeedback
    built = await buildBlendPipelines(rt, device, items, vis.blendBindGroupLayout)
  } while (built && feedback !== vis.writesFeedback)
  return built
}

/**
 * The transmissive stages of a session opened without a transmissive surface, made for the first
 * copies that bring one by the open's own function (`buildBlendPipelines`): the blend programs are
 * built again with the transmissive stages in their module. A refracting copy's distortion targets
 * are asked of the frame as any target is (`holdsRefraction`, `targetsFit`), and it joins once they
 * are in place (`waitsForRefraction`). False when the device refuses the programs.
 */
async function grantTransmission(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  copies: readonly BlendCopy[],
) {
  const { vis } = rt
  const built = await buildGranted(rt, device, itemsOf(rt, copies))
  if (!built?.blendPipelines.transmission) return false
  // Granted meanwhile by another source: those stages stay.
  if (vis.blendPipelines?.transmission) return true
  vis.blendPipelines = built.blendPipelines
  return true
}

/**
 * The blend programs of a session that holds none of the graphs the copies wear, made again with
 * theirs in their modules (`graphProgramsOf`), as the transmissive stages are granted: the programs
 * a graph's functions are in are compiled for the graphs of the items the session was opened with.
 * So are those of a session whose programs do not read the clouds per vertex, when a copy wears a
 * material that receives the clouds in its fog (`cloudFogOf`); those that do not lay the fog per vertex, when a
 * copy wears a surface whose fog is (`fogVertexOf`); those that do not read the
 * translucency lighting volume, when a copy wears a material lit from it (`translucencyVolumeOf`); those
 * without the single-layer water's stage, when a copy wears a water material; and those
 * whose code of the shadows a surface reads lacks what a copy asks (`coversTranslucentShadow`).
 * False when the device refuses the programs.
 */
async function grantGraphs(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  copies: readonly BlendCopy[],
) {
  const { vis } = rt,
    items = itemsOf(rt, copies),
    held = new Set(vis.blendPipelines?.graphs)
  const reads = vis.blendPipelines?.reads
  if (
    graphProgramsOf(items).every((program) => held.has(program.id)) &&
    (!!reads?.clouds || !cloudFogOf(items)) &&
    (!!reads?.fog || !fogVertexOf(items)) &&
    (!!vis.blendPipelines?.translucencyVolume || !translucencyVolumeOf(items)) &&
    (!!vis.blendPipelines?.water || !items.some((item) => item.surface.water)) &&
    coversTranslucentShadow(
      vis.blendPipelines?.translucentShadow,
      translucentShadowOf(
        items,
        readSingleLayerWaterSetting(rt, 'singleLayerWaterShadersSupportVsmFiltering'),
      ),
    )
  )
    return true
  const built = await buildGranted(rt, device, items)
  if (!built) return false
  vis.blendPipelines = built.blendPipelines
  return true
}

/** A copy that refracts: a transmissive surface that declares its ior (`refracts`). */
const refracts = (copy: BlendCopy) => transmits(copy) && copy.surface.refracts

/** Whether the copies wait for the distortion's targets, which only a refracting surface needs:
 *  the frame is asked for them (`refractGranted`, `holdsRefraction`) as it asks any target. */
export function waitsForRefraction(rt: WebgpuPagesRuntime, copies: readonly BlendCopy[]) {
  if (rt.gpu.backdrop?.active || !copies.some(refracts)) return false
  rt.blendState.refractGranted = true
  return true
}

/** Whether the copies wait for the transparents' front layer: a texel in a session opened without a
 *  blend (`createFrontLayer`), remade full size by the frame's targets (`targetsFit`). */
export const waitsForFrontDepth = (rt: WebgpuPagesRuntime, copies: readonly BlendCopy[]) =>
  copies.length > 0 && !rt.gpu.reflection?.front.wanted

/** The compaction, and the occlusion test over it, made on an empty table: the copies' entries
 *  join it with the rest (`growBlend`). False when the device refuses the kernels. */
function mountTransparent(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState } = rt
  return (blendState.mounting ??= (async () => {
    blendState.compaction ??= await createTransparentCompaction(device, blendState.table!)
    if (!blendState.compaction?.encode) return false
    if (!blendState.occlusion) await prepareTransparentOcclusion(rt, device)
    return true
  })().finally(() => (blendState.mounting = undefined)))
}

/**
 * What the copies need compiled before they join: the vertices of their pages no quantized page
 * covers (`loadUnpaged`), the kernels of the transparent pass, the compaction and the occlusion
 * test. False when the device refuses a kernel, the source then being refused (the next opening is
 * told by name).
 */
export async function prepareBlendGrowth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  copies: readonly BlendCopy[],
  pages: readonly PageRec[],
) {
  await loadUnpaged(pages)
  await prepareBlendKernels(rt, device)
  // The blend pass writes a front depth a pixel: the reflection's front depth target is made for it before the
  // copies join (`sceneBlends`, `waitsForFrontDepth`).
  if (copies.length) rt.blendState.frontGranted = true
  if (
    copies.some(transmits) &&
    !rt.vis.blendPipelines?.transmission &&
    !(await grantTransmission(rt, device, copies))
  )
    return false
  if (copies.length && !(await grantGraphs(rt, device, copies))) return false
  if (!copies.length || rt.blendState.compaction?.encode) return true
  return mountTransparent(rt, device)
}

/**
 * The copies join the pass: items, the table's entries for the pages of `roots` — ranked
 * from packed rank `base` on —, the compaction and the occlusion test made to hold them, and the
 * scene buffers over all of the items. One step, between two images.
 */
export function growBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  copies: readonly BlendCopy[],
  roots: readonly ClusterRoot<PageRec>[],
  base: number,
) {
  const { blendState } = rt,
    held = blendState.blendGpu.length
  blendState.transmissive = prepareWebgpuBlend(copies, blendState)
  const added = blendState.blendGpu.slice(held)
  // An item made on a row a parent composes reads it composed from its first image.
  composeItems(rt, added)
  const { table } = blendState
  if (table) {
    const first = table.length
    table.append(roots, base, added)
    // A page of an address the pool holds already is named by no arrival: its span is read from the
    // pool, as the arrival of a page would give it.
    for (let entry = first; entry < table.length; entry++) {
      const page = table.pageOfEntry[entry]
      if (page >= 0) updateTransparentSpan(rt, page, rt.layout.clusters.offsetOf(page))
    }
    blendState.compaction?.grow()
    // The identity of the entries it gained is written at the next diagnostic image.
    blendState.diagnosticMode = undefined
    growTransparentOcclusion(rt)
  }
  mountBlendResources(rt, device)
}
