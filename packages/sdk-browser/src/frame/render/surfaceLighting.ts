import { encodeGlobalFieldStats } from '../../lighting/distanceField/debug/pageStats.ts'
import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts'
import { directTiles, encodeDirectLights } from './encodeLights.ts'
import { prepareLocalFog } from './encodeLocalFog.ts'
import { finishVsmFrame } from '../../lighting/shadows/vsm/frame/vsmFrameEnd.ts'
import { composesOffscreen } from '../../diagnostic/gpuVariant.ts'
import { encodeTaaPass } from '../../post/taa/frame.ts'
import { encodeVelocity } from '../../post/taa/velocityFrame.ts'
import { encodeExposure, exposureSettings } from '../../post/exposure/frame.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { beginFinishScene, encodeFinish, finishedGroup } from '../../post/finish/frame.ts'
import { encodeToneTable } from '../../post/finish/toneFrame.ts'
import { lightingPhase } from '../../lighting/surfaceCache/lighting/phase.ts'
import {
  composedImage,
  encodeEffects,
  encodeLitEffects,
  encodeOverlayEffects,
  encodeResolvedEffects,
} from './encodeEffects.ts'
import { displayBlendablesDrawn } from './encodeBlendables.ts'
import { clearResponsive } from '../prepare/responsiveTarget.ts'
import { bounceViewOf, directLightResources, readsAsIs } from '../prepare/contractLight.ts'
import { wantsContractLighting } from '../prepare/lit.ts'
import { SHADING } from '../../materials/surface/pixelModel.ts'
import {
  encodeSubsurfaceScattering,
  subsurfaceSwitches,
  subsurfaceTransmittanceDistance,
} from '../../lighting/subsurface/frame.ts'
import { encodeAfterWater, encodeSkyAndClouds } from './encodeClouds.ts'
import { encodeSkyPass } from './encodeSkyPass.ts'
import { encodeLightShaftBloom } from '../../modules/sky/lightShafts/frame.ts'
import { encodePreLight } from './preLight.ts'
import { preparePathTracing } from '../../lighting/pathTracing/frame.ts'
import { encodeSkyLightTraced } from '../../lighting/skyLightTraced/skyLightTracedFrame.ts'
import { encodeTranslucencyVolume } from '../../lighting/translucency/frame.ts'
import { readHeterogeneousVolumeSetting } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { encodeHeterogeneousVolumes } from '../../lighting/heterogeneousVolumes/liveShadingFrame.ts'
import { encodeHairStrands } from '../../hair/frame.ts'
import { encodeHairLighting } from '../../hair/lighting.ts'
import { encodeWebgpuGuides, guidesShown } from './encodeGuides.ts'
import { encodeHairDebug } from '../../hair/debugView.ts'
import { encodeSubsurfaceDebug } from '../../lighting/subsurface/visualize.ts'
import { encodeRectLightAtlasDebug } from '../../lighting/rectLightAtlas/debug.ts'
import { encodeShadowCasterBounds } from '../../lighting/shadows/vsm/debug/casterBounds.ts'
import { encodeClipmapStats } from '../../lighting/shadows/vsm/debug/clipmapStats.ts'
import { encodeLightGridDebug } from '../../lighting/tiles/debug/gridDebug.ts'
import { encodeCloudShadowDebug } from './encodeCloudShadowDebug.ts'
import { encodeClusterStats } from '../../lighting/shadows/vsm/debug/clusterStats.ts'
import { encodeClipmapVirtualSpace } from '../../lighting/shadows/vsm/debug/clipmapVirtual.ts'
import { encodeVsmVisualizeView } from '../../lighting/shadows/vsm/debug/visualizeView.ts'
import { encodeSceneDebug } from '../../lighting/surfaceCache/sceneDebug/frame.ts'
import { encodeSampledDebug } from '../../lighting/manyLightsSampled/debug/frame.ts'
import { beginDisplayFilter, endDisplayFilter } from './encodeDisplayFilter.ts'
import {
  bindBlend,
  composeOnto,
  encodeBlend,
  encodeMarkedLayers,
  prepareBlend,
} from './encodeBlend.ts'
import { encodeFrontPass } from '../../blend/frontPass.ts'
import { effectsShown } from '../../post/effects/stagePlan.ts'
import { holdReflectionImage } from '../../lighting/reflections/frame.ts'
import { adoptLitImage } from '../../lighting/reflections/litImage.ts'
import { viewProj } from '../backend/helpers.ts'
import { beginCamera } from '../backend/state/previousCamera.ts'
import { encodeSeeThroughBackground, encodeXray } from '../../visibility/passes/xray.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { BOUNCE_LIGHT_VIEW, lightViewCode, showsRaw } from '../../visibility/shader/shadeMode.ts'
import { createFrameDifference } from './frameDifference.ts'
import { atlasViewReady, drawAtlasView } from '../../lighting/surfaceCache/frame.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import {
  encodeLightPower,
  encodeSampledFront,
  encodeSampledLights,
} from '../../lighting/manyLightsSampled/frame.ts'
import { reflects, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import { encodeViewOverrides, finishUncomposed } from './viewOverrides.ts'

/** The translucency lighting volume's compute pass, after the lit surfaces. */
const volumeRun = new ComputeRun()

const inverseViewProj = new Float64Array(16),
  cameraWorldArray: [number, number, number, number] = [0, 0, 0, 1]
/** The size of the image composed, the display's and the surfaces', refilled each image
 *  (`ComposeSource`). */
const source = {
  drawn: [1, 1] as readonly number[],
  shown: [1, 1] as readonly number[],
  surface: [1, 1] as readonly number[],
}

/** The frame-difference view's resources, when this image of the main view shows it
 *  (`followFrameDifference`). */
function differenceOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.run.diagnostic !== 'frame-difference' || rt.views.active !== rt.views.main) return
  return (rt.gpu.frameDifference ??= createFrameDifference(device))
}

/** The image the composition reads, and the size it is composed at (`source`), from the lit image: the
 *  chain's passes on it come first, the depth of field — the temporal pass resolves what they leave, the
 *  HDR target the lighting wrote where there are none —, then the translucency composed onto it, then
 *  the temporal pass, the exposure measured on
 *  the radiance the image holds, the finishing's passes, the chain's, and the group that finishes it — its
 *  local exposure, the chain's glow, the vignette — when it draws any. Returns it with the temporal pass's
 *  image. */
function encodeImageChain(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  responsive: ReturnType<typeof clearResponsive>,
  raw: boolean,
) {
  const { gpu } = rt
  const blurred = encodeLitEffects(rt, device, encoder, cam)
  // The layers the depth of field has not read, onto the blurred image where it made one, and onto the lit
  // image the next image's reflections keep.
  composeOnto(rt, device, encoder, gpu.hdrView!, blurred)
  const lit = blurred ?? gpu.hdrView!
  const accumulated = encodeTaaPass(rt, device, encoder, cam, lit, responsive)
  // The resolve's image is at the display's size; the lit one, and the chain's over it, at the
  // size drawn, which the composition upscales.
  source.drawn = accumulated ? gpu.displaySize : gpu.targetSize
  source.shown = gpu.displaySize
  // A debug view's as-is pixels are read from the surfaces, at the size drawn.
  source.surface = gpu.targetSize
  // The passes on the resolved image first, the motion blur: the exposure, the finishing and the
  // chain read the image they leave.
  const resolved = encodeResolvedEffects(rt, device, encoder, accumulated, cam, lit)
  // The scene's chain begun on the image, which the exposure's basic method and the finishing both
  // draw from; the exposure the composition multiplies by, measured on the radiance the image holds
  // before the finishing and the chain touch it (or held, a number or the manual method); the
  // finishing's passes, which read it, then the chain's.
  const image = resolved?.color ?? lit
  const exposure = exposureSettings(rt)
  // The half-size image the image's last pass wrote beside the colour — the motion blur's, else the
  // temporal resolve's — is the chain's: no pass draws one over it. An image none wrote it for — the
  // lit one, drawn below the display, or one the temporal pass is off for — has the chain's own.
  const scene = beginFinishScene(rt, device, encoder, image, source.drawn, raw, resolved?.half)
  encodeExposure(rt, device, encoder, scene, image, source.drawn, raw, exposure, preExposureOf(rt))
  const post = encodeFinish(rt, device, encoder, scene, exposure)
  const effects = encodeEffects(rt, device, encoder, resolved, post, source.drawn, lit)
  let composed = effects
  const finish = finishedGroup(rt, post, effects?.glow)
  // The image the passes before the temporal pass made, where nothing else carries it to the composition.
  if (!composed && lit !== gpu.hdrView) composed = composedImage(gpu, lit)
  if (finish) composed = composedImage(gpu, composed?.color ?? lit, composed?.glow, finish)
  return { accumulated, composed }
}

/** The swap-chain view the image is composed onto, none when it composes offscreen: a capture, a
 *  diagnostic variant, a guide (`guided`) or a view placed at a canvas rectangle composes
 *  offscreen; an image withheld — till the view has loaded, or while a load blocks on slow
 *  streaming — composes offscreen and is never shown (`../loop/firstImage.ts`). */
function presentationOf(rt: WebgpuPagesRuntime, guided: boolean) {
  const { gpu, run, capture } = rt
  return capture.capturing ||
    guided ||
    !!rt.views.active.rect ||
    run.imageWithheld ||
    composesOffscreen(rt.context.diagnosticGpuVariant)
    ? undefined
    : gpu.presenter?.targetView(...gpu.displaySize)
}

/** The surfaces lit into the HDR target: the lighting passes bound to the image's resources, its jitter, its
 *  view and its uniforms, then drawn. The view of the lit image is the diagnostic mode's, or — where the host
 *  asks for the irradiance the probes bounced and the frame is lit with the program that reads them — that. */
function lightSurfaces(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  clear: ReturnType<typeof clearValueOf>,
  raw: boolean,
  direct: ArrayLike<number>,
  draw = true,
) {
  const { gpu, run } = rt
  const deferred = gpu.deferred!
  const [width, height] = gpu.targetSize
  const resources = directLightResources(rt)
  deferred.bind(
    gpu.surfaces!,
    gpu.depthView!,
    gpu.hdrView!,
    wantsContractLighting(rt),
    resources,
    (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
  )
  // The jitter the raster drew this image with: the shadow level reads it.
  const taa = gpu.temporal?.frame
  deferred.setJitter(taa?.active ? taa.jitter : null, lightingPhase(rt))
  // The bounced light's view and the toon choice are one decision (`bounceViewOf`).
  deferred.setLightView(
    bounceViewOf(rt, resources) ? BOUNCE_LIGHT_VIEW : lightViewCode(run.diagnostic),
  )
  deferred.setModelSwitches(run.shading[SHADING.switches] | subsurfaceSwitches(rt))
  deferred.setSubsurfaceDistance(subsurfaceTransmittanceDistance(rt))
  deferred.update(inverseViewProj, cameraWorldArray, width, height, clear, raw, direct)
  // The sampled lighting's samples and their screen traces, after the reflection view is staged (`encodePreLight`) and before the lit passes.
  const sampledDirect = directLightResources(rt)
  encodeSampledLights(rt, encoder, sampledDirect)
  // The nearest translucent layer, written by the transparents' front pass (`encodeFrontPass`), lit by the same lighting with its own histories.
  encodeSampledFront(rt, encoder, sampledDirect)
  if (draw) {
    // The size of the lit image's target, which the toon data's targets share (`ContractKey.toonData`).
    const { width: targetWidth, height: targetHeight } = gpu.hdrTexture!
    run.gpuDrawCalls += deferred.light(encoder, gpu.hdrView!, [targetWidth, targetHeight])
  }
}

/** What is drawn over the lit surfaces, in its order: the sky surfaces, the sky, the fog over the whole image, the haze on the
 *  surfaces and the clouds (`air`), a see-through view's background, the transparents (`blendKey`) and the
 *  particles, drawn into the translucency target, the see-through views' edges, the light shafts' bloom; the lit image whole is kept for the next image's reflections.
 *  Returns what the composition goes on from: the responsiveness the transparents wrote and the
 *  display filter's. */
function drawOverLit(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  overrides: ViewOverrides,
  clear: ReturnType<typeof clearValueOf>,
  air: boolean,
  blendKey: ReturnType<typeof bindBlend> | undefined,
  volumes?: () => void,
) {
  // The sky surfaces, over the lit surfaces and ahead of everything that is laid over the image, on the groups over the lights the lit pass
  // resolved (`lightSurfaces` made its resources after the first binding): they read nothing the sky, the fog and the volumes make.
  encodeSkyPass(rt, device, encoder, !!blendKey)
  // The sky where no surface was drawn, the fog over it and the surfaces, the haze on the surfaces and
  // the clouds over them, before the transparents are drawn.
  encodeSkyAndClouds(rt, device, encoder, cam, air)
  // A see-through view's opaque background, which its edges are drawn over
  // (`../../visibility/passes/xray.ts`).
  encodeSeeThroughBackground(rt, encoder, clear)
  const responsive = clearResponsive(rt, device, encoder)
  const filter = beginDisplayFilter(rt, device)
  volumes?.()
  // Bound again with the lit pass's resources (`lightSurfaces`, resolved after the shadows' projection and every
  // pass that makes one); nothing between makes another, so they are held, not resolved again.
  encodeBlend(
    rt,
    device,
    encoder,
    blendKey && bindBlend(rt, device, true),
    overrides.particles ? directTiles() : undefined,
  )
  // What the image held back for the water is laid after it (`encodeBlend`); an image that did not reach that stage lays it here, none is lost.
  encodeAfterWater(rt)
  // An image that shows no effects has no depth of field to wait for, and one the chain does not
  // follow (`overrides.post`) no pass to compose in: its layers are composed at once, under the
  // see-through views' edges, an overlay on the image and its layers
  // (`../../visibility/passes/xray.ts`).
  if (!effectsShown(rt) || !overrides.post) composeOnto(rt, device, encoder, rt.gpu.hdrView!)
  encodeXray(rt, device, encoder)
  // The light shafts' bloom, added onto the lit image the translucency is composed onto, before the
  // temporal pass and the effects read it.
  encodeLightShaftBloom(rt)
  // The lit image whole, before its resolve: the next image's reflections read it.
  if (reflects(overrides)) holdReflectionImage(rt)
  return { responsive, filter }
}

/** The display image composed from the image the chain left (`image`), and what follows it: the display filter,
 *  the chain's passes after tone mapping, the canvas, the guides, the transparents' maps swapped, the lit image
 *  adopted as the view's lit image. Returns whether it landed on the presented swap-chain view. */
function composeImage(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  image: ReturnType<typeof encodeImageChain>,
  asIs: boolean,
  clear: ReturnType<typeof clearValueOf>,
  filter: ReturnType<typeof beginDisplayFilter>,
) {
  const { gpu, run } = rt
  const { accumulated, composed } = image
  const guided = guidesShown(rt)
  const presentation = presentationOf(rt, guided)
  // The frame-difference view composes the display image alone, then draws its difference with
  // the image before onto the canvas (`frameDifference.ts`).
  const difference = presentation && differenceOf(rt, device)
  // The views of the surface cache's atlas draw it onto the canvas in place of the image
  // (`lighting/surfaceCache/debug.ts`).
  const atlas = !!presentation && atlasViewReady(rt)
  const shown = difference || atlas ? undefined : presentation
  run.gpuDrawCalls++
  // The display colour is written beside the canvas where something reads it: a filter or an
  // overlay drawn over it; else the canvas alone, and the canvas holds the image (`composed`
  // below) for the held frames. A reader of the display colour composes it again from what is kept
  // (`freshDisplay`).
  const writesDisplay =
    !shown ||
    !!filter ||
    !!rt.context.effects?.stage('after-tone-mapping').length ||
    displayBlendablesDrawn(rt)
  gpu.canvasOnly = writesDisplay ? undefined : { clear, composed, asIs, source }
  gpu.deferred!.compose(
    encoder,
    gpu.displayView!,
    clear,
    shown,
    composed,
    asIs,
    source,
    writesDisplay,
  )
  if (filter) endDisplayFilter(rt, filter, encoder, accumulated?.filter, shown)
  // The chain's passes after tone mapping, over the display image whole: an outline's line.
  encodeOverlayEffects(rt, device, encoder, shown)
  // Composition and filter wrote the canvas what they wrote the display colour: it holds it. The
  // difference's canvas holds no display colour: such a view is never held (`holdWebgpuFrame`).
  if (difference && presentation) difference.encode(encoder, gpu.displayTexture!, presentation)
  else if (atlas && presentation) drawAtlasView(rt, device, encoder, presentation, gpu.displaySize)
  else if (presentation)
    gpu.presenter!.composed(gpu.displayTexture!, gpu.displaySize[0], gpu.displaySize[1])
  if (guided) encodeWebgpuGuides(rt, encoder, cam)
  // The hair strands' debug views, over the image and the guides.
  encodeHairDebug(rt, device, encoder, cam)
  // The sampled lighting's debug views, over the image too.
  encodeSampledDebug(rt, device, encoder, cam)
  encodeSubsurfaceDebug(rt, device, encoder, cam)
  // The virtual shadow maps' shadow caster boxes, over the image when asked.
  encodeShadowCasterBounds(rt, device, encoder, cam)
  encodeClipmapVirtualSpace(rt, device, encoder)
  encodeVsmVisualizeView(rt, device, encoder, cam)
  encodeClipmapStats(rt, device, encoder, cam)
  encodeClusterStats(rt, device, encoder, cam)
  // The clouds' shadow and sky occlusion maps, over the image when asked.
  encodeCloudShadowDebug(rt, device, encoder, cam)
  // The light grid's cells, over the image when asked.
  encodeLightGridDebug(rt, device, encoder)
  // The global distance field's page statistics, over the image when asked.
  encodeGlobalFieldStats(rt, device, encoder, cam)
  // The rectangle lights' atlas, drawn over the image when asked.
  encodeRectLightAtlasDebug(rt, device, encoder, cam)
  // The surface cache's tables and boxes, over the image too.
  encodeSceneDebug(rt, device, encoder, cam)
  // The transparents read this frame's maps: the frame's buffers swap only now.
  finishVsmFrame(rt, encoder)
  // Every pass of the image that reads or writes the HDR target is encoded: the lit image becomes
  // the view's lit image, and the HDR target the next image lights is the other one.
  adoptLitImage(gpu)
  return !!presentation
}

/** The tone table the composition reads the display value from, baked again where a setting or the
 *  scene's display curve changed: first, so that the transparents drawn on display values, which
 *  copy its words (`writeBlendView`, `drawParticles`), show the colours it gives; then the hair
 *  strands' tangents, macro groups and bounds, once the surfaces are drawn and before the shadows'
 *  pages are marked (`encodeDirectLights`). */
function encodeToneAndHair(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  encodeToneTable(rt, encoder)
  encodeHairStrands(rt, device, encoder, cam)
}

/** The translucency lighting volume, built over the same shadow maps once the surfaces are lit (the
 *  blends lit from it read it), then the diffuse light of the subsurface-profile pixels scattered
 *  over the lit image, before the sky, the fog and the transparents. */
function encodeVolumeAndScattering(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  encodeTranslucencyVolume(rt, device, volumeRun.begin(encoder), cam)
  volumeRun.end()
  encodeSubsurfaceScattering(rt, encoder, cam)
}

/** Lights the surfaces into the HDR target, draws the forward transparents over it, and composes the
 *  display image at its size; returns whether it landed on the presented swap-chain view. */
export function encodeSurfaceLighting(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, run } = rt,
    clear = clearValueOf(run.clearColor)
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.displayView)
    throw new Error('DEFERRED_UNAVAILABLE')
  // The camera of the image before, kept once for the histories that reproject by it (`beginCamera`).
  beginCamera(rt, cam)
  const overrides = encodeViewOverrides(rt, device, encoder, gpu.surfaces)
  // The motion of every texel, once, before any pass reads it: the indirect light, the temporal pass
  // and the motion blur (`../../post/taa/velocityFrame.ts`).
  encodeVelocity(rt, device, encoder, cam)
  // A view the resolve paints, and a lit view that measures, are shown in raw values; a view of
  // the lit image otherwise goes through the display chain as the lit image does (`showsRaw`).
  const raw = showsRaw(run.diagnostic)
  invertMatrix4(inverseViewProj, viewProj)
  encodeToneAndHair(rt, device, encoder, cam)
  // The transparents are selected and ordered first; light lists encode before resolve, its inputs —
  // every lighting resource the blend group names made with them.
  const blendRuns = prepareBlend(rt, encoder, cam)
  // What the sun's page marking reads of the transparents, in the lights (`encodeDirectLights`): the
  // water's depth, and the front layer where no image before left one.
  // The change of each light's power since the image before, measured at the head of the lighting for every sampling that follows.
  encodeLightPower(rt, encoder, cam.eye, preExposureOf(rt))
  encodeMarkedLayers(rt, device, encoder, blendRuns)
  const air = encodeDirectLights(rt, device, encoder, cam, viewProj, inverseViewProj, blendRuns)
  const direct = directTiles()
  // The local fog volumes of the view in the light buffer just pushed, and the buffer of their lists,
  // made before any group binds the fog's resources.
  prepareLocalFog(rt, device, cam)
  for (let i = 0; i < 4; i++) cameraWorldArray[i] = cam.viewPoint[i]
  // The transparents bound for the image, and their front pass drawn: their nearest depth and the
  // surface the trace reads.
  const blendKey = blendRuns ? bindBlend(rt, device) : undefined
  if (blendKey) encodeFrontPass(rt, device, encoder)
  // The shadows the heterogeneous volumes cast, built before any light is applied.
  encodeHeterogeneousVolumes(rt, device, encoder, cam, 'shadows')
  encodePreLight(rt, device, encoder, cam, direct, overrides)
  // A path-traced view draws its own lit image: the lighting is set up all the same, and drawn first only where the tracer draws beside it (the wiper).
  const traced = preparePathTracing(rt, device, encoder, cam)
  lightSurfaces(rt, encoder, clear, raw, direct, !traced || traced.wiper)
  if (traced && gpu.depthView) traced.draw(gpu.hdrView, gpu.depthView)
  // The sky lit by rays, added to the lit image once the lights are on it (the reference composites it after the subsurface pass); the indirect pass cut the sky's diffuse for it.
  encodeSkyLightTraced(rt, device, encoder, cam)
  // The hair strands are lit with the lights; they are laid on the image where `hairStrandsComposition` says (`encodeBlend`).
  encodeHairLighting(rt, device, encoder, cam)
  encodeVolumeAndScattering(rt, device, encoder, cam)
  // Composited with the translucency (`Translucency` on), the volumes go before the transparents, which are then drawn over them, or after
  // them as `Composition` says; else after (`GetHeterogeneousVolumesComposition`, `HeterogeneousVolumes.cpp:403`).
  const volumesFirst =
    !!readHeterogeneousVolumeSetting(rt, 'heterogeneousVolumesTranslucency') &&
    readHeterogeneousVolumeSetting(rt, 'heterogeneousVolumesComposition') === 0
  const { responsive, filter } = drawOverLit(
    rt,
    device,
    encoder,
    cam,
    overrides,
    clear,
    air,
    blendKey,
    volumesFirst ? () => encodeHeterogeneousVolumes(rt, device, encoder, cam) : undefined,
  )
  // The heterogeneous volumes, over the lit image once the sky, the fog and the transparents are on it (the default composition: after the translucency).
  if (!volumesFirst) encodeHeterogeneousVolumes(rt, device, encoder, cam)
  if (!overrides.post) return finishUncomposed(rt, encoder, overrides, filter)
  // Composition reads the temporal result, or the lit image without accumulation.
  const asIs = readsAsIs(rt)
  const image = encodeImageChain(rt, device, encoder, cam, responsive, raw)
  return composeImage(rt, device, encoder, cam, image, asIs, clear, filter)
}
