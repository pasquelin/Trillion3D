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
import { limitOf } from '../materials/closures/closureLimit.ts'
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
  reachedBy,
  cloudFogOf,
  fogVertexOf,
  coversTranslucentShadow,
  translucentShadowOf,
} from './pipelines.ts'
import { contactShadowsOf, translucencyVolumeOf } from '../materials/surface/blendLightSource.ts'
import { readSingleLayerWaterSetting } from '../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { composeItems } from '../placement/compose/gpuCompose.ts'
import { mountBlendResources, prepareBlendKernels } from './resources.ts'
import { lobedSurface } from './items.ts'
import { activeResponsive } from '../frame/prepare/responsiveTarget.ts'
import { keyFor, worldVariant } from '../frame/prepare/contractLight.ts'
import { wantsContractLighting } from '../frame/prepare/lit.ts'
import { FULL_CONTRACT } from '../lighting/deferred/contractCuts.ts'
import { variantKey, type BlendVariant } from './variant.ts'

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
export async function buildGranted(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  items: ReturnType<typeof itemsOf>,
  holdsTransmission?: boolean,
  world?: BlendVariant,
) {
  const { vis } = rt
  let built: Awaited<ReturnType<typeof buildBlendPipelines>>, feedback: boolean
  do {
    feedback = vis.writesFeedback
    // Programs built for another verdict of the object shadow switch are made on the layouts of that verdict, not the session's.
    built = await buildBlendPipelines(
      rt,
      device,
      items,
      world === undefined ? vis.blendBindGroupLayout : undefined,
      holdsTransmission,
      world,
    )
  } while (built && feedback !== vis.writesFeedback)
  return built
}

/** The variant the programs in place stand for, as the world is asked: the water's cut is the world's where there are no water programs (those hold none to
 *  follow); true where there are no programs (`BlendVariant`). */
const appliedVariant = (rt: WebgpuPagesRuntime): BlendVariant | undefined => {
  const programs = rt.vis.blendPipelines
  if (!programs) return undefined
  const world = worldVariant(rt)
  return {
    exclusion: programs.water ? programs.water.exclusion : world.exclusion,
    objectShadow: programs.world.objectShadow,
  }
}

/** Whether the water programs in place are the variant the world asks: with the cut where it holds an exclusion volume, else without
 *  (`blendContext`, `BlendVariant.exclusion`); true where there are no water programs. */
const followsExclusion = (rt: WebgpuPagesRuntime) => {
  const water = rt.vis.blendPipelines?.water
  return !water || water.exclusion === worldVariant(rt).exclusion
}

/** Whether the programs in place are the variant the world asks, one key comparison: the water's cut and the object shadow read; true where there are no programs. */
const followsWorld = (rt: WebgpuPagesRuntime) => {
  const applied = appliedVariant(rt)
  return !applied || variantKey(applied) === variantKey(worldVariant(rt))
}

/** The runtimes whose programs are being built again for the world, and the variant a refused build was made for (not
 *  made again until the plan or the verdict changes). */
const following = new WeakSet<WebgpuPagesRuntime>()
const refusedFor = new WeakMap<WebgpuPagesRuntime, { key: string; plan: object }>()

/**
 * Keeps the programs in step with the world, at an image's entry: a water exclusion volume that appears or goes while the session runs, or the switch
 * `translucentObjectShadows` turned on or off, asks the programs built again over the items the session holds (`buildGranted`), off the frame, the
 * transmissive stages it holds kept. A change of the switch builds the group layouts again with them (the read's bindings are in the layouts of the programs that
 * read), and the groups are listed again (`voidStaleBlendGroups`). They land only if nothing replaced the programs meanwhile (a feedback variant, a grant,
 * a drop): else they are asked again at the next image, and the image is drawn again once they are in place.
 * The feedback variant compiling aside waits for its install, which carries the verdict it was built for (`followFeedback`).
 */
export function followBlendWorld(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, blendState } = rt,
    before = vis.blendPipelines
  if (!before || followsWorld(rt) || following.has(rt) || vis.feedbackAside) return
  const asks = worldVariant(rt),
    key = variantKey(asks),
    plan = blendState.seeds,
    refused = refusedFor.get(rt)
  if (refused?.key === key && refused.plan === plan) return
  following.add(rt)
  void buildGranted(
    rt,
    device,
    blendState.blendGpu,
    !!before.transmission,
    before.world.objectShadow === asks.objectShadow ? undefined : asks,
  )
    .then((built) => {
      if (!built) refusedFor.set(rt, { key, plan })
      else if (vis.blendPipelines === before && !vis.feedbackAside) {
        vis.blendPipelines = built.blendPipelines
        vis.blendBindGroupLayout = built.blendBindGroupLayout
      }
      // Installed, or replaced meanwhile and asked again: the image is drawn again.
      if (built) rt.run.gate.resourcesChanged()
    })
    .finally(() => following.delete(rt))
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
 * copy wears a surface whose fog is (`fogVertexOf`); those that do not hold the contact shadows' code, when a copy wears a
 * material that has the lights cast them on it (`contactShadowsOf`); those that do not read the
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
    graphProgramsOf(items, limitOf(rt.vis)).every((program) => held.has(program.id)) &&
    (!!reads?.clouds || !cloudFogOf(items)) &&
    (!!reads?.fog || !fogVertexOf(items)) &&
    (!!vis.blendPipelines?.scene?.contact || !contactShadowsOf(items)) &&
    (!!vis.blendPipelines?.translucencyVolume || !translucencyVolumeOf(items)) &&
    (!!vis.blendPipelines?.water || !items.some((item) => item.surface.water)) &&
    followsExclusion(rt) &&
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
 * THE ENTRY OF A LAYER: the copies do not join the pass before the programs that draw them are compiled, as a render proxy is not created while its pipeline states precache.
 * The lights' key the frame will light them with is read as `askBlendReach` reads it, their lobes from their surfaces (`lobedSurface`); the program of that key is made, then
 * it is widened by the scope the copies bring (`reachedBy`, their modes and what they need: the display layers, the holdout, the responsiveness, the transmission) and
 * everything that scope reaches is compiled with no frame waiting (`BlendModePipelines.prepare`). The frames then find it made when the scene's reach widens (`reach`).
 */
async function layersCompiled(rt: WebgpuPagesRuntime, copies: readonly BlendCopy[]) {
  const { blendPipelines } = rt.vis
  if (!blendPipelines) return
  const lobed =
      rt.blendState.lobed || copies.some((copy) => lobedSurface(copy.surface, limitOf(rt.vis))),
    key = wantsContractLighting(rt) ? keyFor('blend', rt) : FULL_CONTRACT
  await blendPipelines.litAwaited(key, lobed)
  const program = blendPipelines.lit(key, lobed)
  const items = itemsOf(rt, copies)
  if (program) {
    const widened = reachedBy(items, !!activeResponsive(rt), rt.context.diagnosticGpuVariant)
    await program.prepare(widened)
  }
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
  // The layers' programs are compiled before they join: the frames wait for none of them.
  if (copies.length) await layersCompiled(rt, copies).catch(() => undefined)
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
