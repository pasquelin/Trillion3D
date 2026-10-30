import { drawsFrontBeforeSampledMarking } from '../../lighting/manyLightsSampled/frame.ts'
import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { countBlendDraws, drawBlendPass, encodeHoldout } from '../../blend/draw.ts'
import { writeBlendView } from '../../blend/uniforms.ts'
import { cutSkyItems } from '../../blend/expand/expansionViews.ts'
import { viewSky } from './skyRoots.ts'
import { viewKey } from '../backend/state/viewKey.ts'
import type { BlendGpuItem } from '../../blend/state.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { encodeBlendExpansion } from '../../blend/expand/expansionFrame.ts'
import { orderBlendPasses } from '../../blend/order/order.ts'
import { encodeTransparentInstances } from '../../blend/transparent/draw.ts'
import { encodeDistortion } from '../../blend/distortion.ts'
import { encodeWater, encodeWaterDepth } from '../../blend/water/waterPass.ts'
import { waterTargetsOf } from '../../blend/water/waterTargets.ts'
import { encodeAfterWater } from './encodeClouds.ts'
import { encodeFrontPass } from '../../blend/frontPass.ts'
import {
  drawsFrontBeforeMarking,
  drawsWaterBeforeMarking,
} from '../../lighting/shadows/vsm/frame/vsmFrontLayer.ts'
import { drawParticles, encodeParticles } from '../../particles/gpu/webgpuParticleFrame.ts'
import { forget } from '../../blend/translucency.ts'
import { composeLateOnto, composeTranslucency } from '../../blend/translucencyCompose.ts'
import { layerDraws } from '../../blend/translucencyPhase.ts'
import { effectsShown } from '../../post/effects/stagePlan.ts'
import { keepsLitImage } from '../../lighting/reflections/frame.ts'
import { encodeTracedTranslucency } from '../../lighting/reflections/translucency/stage.ts'
import { blendLightResources } from '../../blend/lighting.ts'
import { directLightResources, heldDirectLightResources } from '../prepare/contractLight.ts'
import { holdoutOn } from '../prepare/alphaHoldout.ts'
import { voidStaleBlendGroups } from '../../blend/identity.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { composeHairStrands } from '../../hair/lighting.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { transparentCounts } from '../backend/state/transparentCounts.ts'

const NO_SKY: ReadonlySet<BlendGpuItem> = new Set()

/** World-space eye of the image, the view uniform's: with no camera the lists keep their order. */
const blendEye = (rt: WebgpuPagesRuntime) => (rt.run.lastCamera ? rt.run.gate.cam.eye : undefined)

/**
 * The transparents of an image, selected, ordered and expanded ahead of anything that draws them:
 * `false` without the pass's resources. The compaction reads the mask this very frame's cluster cut
 * wrote, a few commands earlier in the same buffer, and writes the instance list the runs draw from; the sky surfaces it expands are
 * those the view of `cam` draws (`viewSky`). `skyOnly`: a face of the sky meshes
 * prepares the sky view alone: no occlusion test of the main view strips its clusters, the sky view is the one expanded, the
 * main image's views and verdict counts are left as they are, and the frustum verdict runs on the planes of the face's own camera (`orderBlendPasses`).
 */
export function prepareBlend(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  skyOnly = false,
): boolean {
  const { gpu, vis, run, timing, blendState } = rt
  const ready = !!(
    blendState.blendGpu.length &&
    // The target the pass draws into (`drawBlendPass`).
    gpu.hdrView &&
    gpu.depthView &&
    vis.blendBindGroupLayout &&
    vis.blendPipelines &&
    vis.textures &&
    vis.mapsSampler &&
    vis.concatPos &&
    vis.concatUv &&
    vis.concatNrm &&
    gpu.zeroUv &&
    blendState.itemBuffer &&
    blendState.viewBuffer &&
    blendState.argsBuffer &&
    blendState.expandedBuffer
  )
  if (!ready) return false
  const cpuStart = cpuNow()
  // A face of the sky meshes strips nothing the main view's occlusion test hid (`encodeTransparentInstances`).
  encodeTransparentInstances(rt, encoder, !skyOnly)
  const main = rt.views.active === rt.views.main
  // With no sky surface it clears the cut words a scene that had some left.
  cutSkyItems(
    blendState,
    blendState.skyItems.length ? viewSky(rt, cam.viewSet, main).items : NO_SKY,
  )
  // The few own entries' order on the CPU, the frame's head for the GPU — the eye, the frustum
  // planes —; the GPU judges every item and sorts them far to near (a blend writes no depth).
  orderBlendPasses(blendState, blendEye(rt))
  // The GPU judges, orders and expands the plan: instances, one indirect argument per slot.
  encodeBlendExpansion(rt, encoder, skyOnly)
  // The image's reject count is its view's own, the GPU's, read back a few images late (`verdictRead.ts`).
  if (!skyOnly)
    run.blendFrustumRejected = blendState.expand?.peekVerdict(viewKey(rt.gpu))?.latest.rejected ?? 0
  const elapsed = msSince(cpuStart)
  timing.transparentPrepareMs += elapsed
  return true
}

/**
 * What the transparents of an image draw with, once `prepareBlend` prepared them, before any pass of
 * theirs but those the page marking reads (`encodeMarkedLayers`) — the front pass the reflection trace
 * reads (`encodeFrontPass`) and the blend pass —: the blend view, the material records the item
 * records name, and the groups, a real resource voiding a placeholder's group. Returns the frame's
 * lights' key, which picks the blend programs (`createForwardVariants`). `held`: the lights are those
 * the lit pass just resolved (`heldDirectLightResources`), none made since: they are not resolved again.
 */
export function bindBlend(rt: WebgpuPagesRuntime, device: GPUDevice, held = false) {
  const { timing } = rt
  const cpuStart = cpuNow()
  writeBlendView(rt, device)
  const contract = held ? heldDirectLightResources() : directLightResources(rt)
  bindBlendGroups(rt, device, contract)
  const elapsed = msSince(cpuStart)
  timing.transparentPrepareMs += elapsed
  return contract
}

/**
 * What the sky surfaces draw with, bound ahead of the atmosphere, the fog and the clouds of the image: the groups over the lights of
 * `contract`, and nothing the image makes later. A sky surface is unlit and takes no fog of its own, so the cloud image, the clouds' shade
 * and the volumes' camera map are their stand-ins (`blendLightResources`'s `sky`), none held for the image: `bindBlend` binds the real
 * ones before the transparents. The blend view is not written here: the one write of the image (`bindBlend`, or the caller's)
 * is the one the commands read. `held`: the lights are those the lit pass just resolved (`bindBlend`). Returns the frame's lights' key.
 */
export function bindSkySurfaces(rt: WebgpuPagesRuntime, device: GPUDevice, held = false) {
  const cpuStart = cpuNow()
  const contract = held ? heldDirectLightResources() : directLightResources(rt)
  bindBlendGroups(rt, device, contract, true)
  rt.timing.transparentPrepareMs += msSince(cpuStart)
  return contract
}

/** The material records the item records name, and the groups over the lights of `contract`, a real
 *  resource voiding a placeholder's group: what a draw of the transparents binds, the blend view
 *  (`writeBlendView`) apart, which the queue writes before the image's commands run. `sky`: the sky surfaces' (`bindSkySurfaces`). */
function bindBlendGroups(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  contract: ReturnType<typeof directLightResources>,
  sky = false,
) {
  // The material records the item records named go up before a group names their texture.
  rt.vis.materialTable.viewFor(device)
  voidStaleBlendGroups(rt, blendLightResources(rt, contract, sky))
}

/**
 * What the sun's page marking reads of the transparents (`encodeVsmFrame`), drawn before the image's
 * lights, on the groups `bindBlend` makes again over the lights once they are made:
 *  - the single-layer water's depth (`encodeWaterDepth`), where the scene has water drawn
 *    (`drawsWaterBeforeMarking`): the marking marks the sun's pages at the water's surface;
 *  - the transparents' front pass (`encodeFrontPass`), where the translucent surfaces' shadow is traced
 *    and the image before left the marking no front layer to read (`drawsFrontBeforeMarking`): the
 *    marking reads this image's own, and the pass is not drawn again after the lights.
 * `prepared`: the transparents were prepared (`prepareBlend`). Nothing where no sun's pages are marked.
 */
export function encodeMarkedLayers(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  prepared: boolean,
) {
  if (!prepared) return
  const water = drawsWaterBeforeMarking(rt),
    front = drawsFrontBeforeMarking(rt) || drawsFrontBeforeSampledMarking(rt)
  if (!water && !front) return
  const cpuStart = cpuNow()
  // Resolved here, ahead of the lights: what is held is the image before's.
  const contract = directLightResources(rt)
  bindBlendGroups(rt, device, contract)
  rt.timing.transparentPrepareMs += msSince(cpuStart)
  if (water) countBlendDraws(rt, encodeWaterDepth(rt, device, encoder, contract))
  if (front) encodeFrontPass(rt, device, encoder)
}

/**
 * The one place the image's layers are composed onto the lit image: the translucency target drawn lies
 * over every view of `onto` (`composeTranslucency`) — but over the one the depth of field's recombine
 * composed them into, the last, and over the lit image the reflections keep only where they keep it
 * (`keepsLitImage`). Called for the layers of the pass before the depth of field (`encodeBlend`), and
 * for the others where the image composes them (`drawOverLit` where it shows no effects,
 * `encodeImageChain` else). The layers of the pass after the motion blur go on at once where the
 * image shows no effect (`effectsShown`), else after the motion blur (`encodeResolvedEffects`).
 */
function composeLayers(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  onto: readonly GPUTextureView[],
) {
  const fused = rt.gpu.translucency?.phase === 'fused'
  composeTranslucency(rt, device, encoder, onto, fused ? Number(keepsLitImage(rt)) : onto.length)
  if (!effectsShown(rt)) composeLateOnto(rt, device, encoder, onto)
}

/** The views `composeOnto` composes onto, refilled each image: `composeLayers` copies them out. */
const ontoOne: GPUTextureView[] = [],
  ontoTwo: GPUTextureView[] = []

/** `composeLayers` onto `first` alone, or onto `first` then `second`. */
export function composeOnto(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  first: GPUTextureView,
  second?: GPUTextureView,
) {
  const onto = second ? ontoTwo : ontoOne
  onto[0] = first
  if (second) onto[1] = second
  composeLayers(rt, device, encoder, onto)
}

/** The alpha holdout, once every layer is drawn: all of them, whichever pass they are composed in. The
 *  pools' layers join the accumulation only where the alpha holdout is not in effect (`holdoutOn`), a
 *  premultiplied pool then letting `1 − coverage` through as a premultiplied layer does; in effect, a
 *  premultiplied or additive pool touches nothing of it, as such a layer does not. */
function encodeAlphaHoldout(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  contract: Partial<ContractKey>,
  tone?: ArrayLike<number>,
) {
  const particles =
    tone && !holdoutOn(rt)
      ? (held: GPUTextureView) => drawParticles(rt, encoder, tone, undefined, held)
      : undefined
  countBlendDraws(rt, encodeHoldout(rt, device, encoder, contract, particles))
}

/** The trace of an image's transparent encoding. */
function traceTransparentEncoding(rt: WebgpuPagesRuntime) {
  const { run, timing, blendState, diag } = rt
  if (diag.traceEnabled)
    diag.traceDiagnostic(
      'transparent-encoding',
      'Transparent surfaces selected and encoded',
      () => ({
        frame: run.frame,
        submission: run.imageRevision,
        ...transparentCounts(rt),
        transmissiveMeshes: blendState.transmissive,
        encodeMs: timing.transparentPrepareMs + timing.transparentDrawMs,
      }),
    )
}

/** Draws the translucent layers of an image — the transparents bound by `bindBlend`, lit with the
 *  lights' key `contract` it returned (none where they were not prepared), then the particles `tone`
 *  shows (none: not drawn) — after the distortion of the opaque scene, so refraction bends only
 *  what lies behind. They go into the translucency target, which the image composes once the depth
 *  of field has read it (`encodeDistortion`, `drawBlendPass`, `drawParticles`, `composeLayers`) —
 *  but for the layers of the pass before it, which the depth of field blurs, and the single-layer water,
 *  shaded over the scene before any of them (`encodeWater`): with the depth of field
 *  drawn and layers in both passes (`splitsTranslucency`), the same draws run once for them,
 *  composed onto the lit image at once, then for the others —, and the layers of the pass after the
 *  motion blur, which go into the second set of targets (`TranslucencyTargets.late`). Where
 *  the layers make more than one draw, each draws the layers of its passes alone (`layerDraws`, `expansionViews.ts`). */
export function encodeBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  contract: Partial<ContractKey> | undefined,
  tone?: ArrayLike<number>,
) {
  const { timing, vis, gpu, blendState } = rt
  // The translucency targets hold nothing of this image until a pass draws (`drawBlendPass`).
  const main = gpu.translucency
  if (main) forget(main)
  if (main?.late) forget(main.late)
  // Every image reaches this stage: the particles step here.
  encodeParticles(rt, device, encoder)
  const prepared = cpuNow()
  // The draws of the layers (`layerDraws`): each expands and draws the items of its own passes alone.
  const draws = layerDraws(rt)
  // The single-layer water, over the scene without it, before the layers that refract or blend it.
  const waterDrawn = contract ? encodeWater(rt, device, encoder, contract) : 0
  if (contract) countBlendDraws(rt, waterDrawn)
  // The sky, the fog, the haze and the clouds the image held back, over the water now shaded, before any layer is drawn over them.
  encodeAfterWater(rt, waterDrawn ? waterTargetsOf(rt, device).views.specular : undefined)
  // The strands, over the sky and the fog laid, before any layer is drawn when the setting puts them there.
  composeHairStrands(rt, device, encoder, 'beforeTranslucent')
  if (contract)
    countBlendDraws(rt, encodeDistortion(rt, device, encoder, vis.blendPipelines?.transmission))
  // The see-through surfaces drawn by rays in the lit image, where the image can trace them: the raster draws of the transparents are left out then (particles are still drawn).
  const traced = encodeTracedTranslucency(rt, device, encoder)
  for (const { at, active, only } of draws) {
    if (!active) continue
    // The late layers draw into their own targets, which the draws read as the translucency target.
    if (at === 2) gpu.translucency = main!.late
    if (contract && !traced) drawBlendPass(rt, device, encoder, contract, blendState.drawViews[at])
    if (tone) drawParticles(rt, encoder, tone, only || undefined)
    gpu.translucency = main
    if (at === 0) {
      composeOnto(rt, device, encoder, gpu.hdrView!)
      // What the temporal pass reads of the translucency is that of the later pass.
      if (main) forget(main)
    }
  }
  // The strands, over the layers composed in the lit image, before the translucency composed after the depth of field.
  composeHairStrands(rt, device, encoder, 'afterTranslucent')
  if (!contract) return
  encodeAlphaHoldout(rt, device, encoder, contract, tone)
  timing.transparentDrawMs += cpuNow() - prepared
  traceTransparentEncoding(rt)
}
