import type { EngineCamera } from '../../camera/engineCamera.ts'
import { readHizSetting } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import {
  environmentCurve,
  environmentSharpness,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import {
  readFilmSetting,
  tonemapperSharpness,
} from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { beginPreExposure } from '../../post/exposure/pre.ts'
import { cachedLightingPreExposureOf } from '../../post/exposure/frame.ts'
import { DIRECT_AT } from '../../lighting/deferred/view.ts'
import { uploadSceneLights } from '../backend/state/lightBuffer.ts'
import { followSkinTable } from '../../lighting/direct/skinTableSource.ts'
import { followSubsurfaceProfiles } from '../../lighting/subsurface/litRows.ts'
import { ensureBounce, syncBouncePlacements } from '../prepare/bounce.ts'
import { followGlobalLighting } from '../prepare/globalLighting.ts'
import type { QueuedBounce } from '../backend/state/bounce.ts'
import { createMarkSurface, NO_MARKERS, type MarkProbes } from '../../lighting/bounce/pool/pool.ts'
import { screenProbesCast } from '../../lighting/bounce/screen/cast.ts'
import { lastCastProbes } from '../../lighting/bounce/screen/frame.ts'
import {
  encodeTranslucencyCache,
  releaseTranslucencyCache,
  restartTranslucencyCache,
} from '../../lighting/translucencyGi/cache.ts'
import { radianceMarker } from './encodeBlend.ts'
import { translucencyGiMarkers } from '../../lighting/translucencyGi/marker.ts'
import { planVsmFrame } from '../../lighting/shadows/vsm/frame/vsmPlan.ts'
import { encodeVsmFrame } from '../../lighting/shadows/vsm/frame/vsmEncode.ts'
import { lightGridCull } from '../../lighting/tiles/cullView.ts'
import { drawLights, lightDrawViewOf } from '../../lighting/lightDrawRange.ts'
import { vsmMapSettings } from '../../lighting/shadows/vsm/frame/vsmFarShadow.ts'
import {
  encodeLightFunctions,
  lightFunctionResources,
  lightFunctionRevision,
} from '../../lighting/lightFunction/frame.ts'
import { encodeLightProfiles } from '../../lighting/lightProfile/frame.ts'
import { encodeDistanceFields } from '../../lighting/distanceField/frame.ts'
import {
  demandSurfaceCache,
  encodeSurfaceCache,
  surfaceHitReads,
} from '../../lighting/surfaceCache/frame.ts'
import { lightSurfaceCache } from '../../lighting/surfaceCache/lighting/frame.ts'
import { sceneRaysOf } from '../../lighting/surfaceCache/lighting/surfaceLighting.ts'
import { heldSkyLight } from './skyLightHeld.ts'
import { skyLightPending, skyLightReadOf } from './skyLightState.ts'
import { cloudShadowOf, encodeCloudShadow } from './encodeCloudShadow.ts'
import { encodeAtmosphere } from './encodeAtmosphere.ts'
import { requestSkyAir } from './encodeClouds.ts'
import { encodeSkyCapture } from './encodeSkyLight.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The floats the deferred and blend passes reread: lights, tiles in X and Y, exposure, display
 *  curve, the eye the fog is measured from, the composition's sharpening strength, then the image's
 *  pre-exposure and the scale it is shown at (`PreExposure`), then whether it carries an alpha channel. */
const directParams = new Float32Array(DIRECT_AT.words)
/**
 * The image's exposure words. Exposure is not a light: it sets conversion of radiance into an image,
 * and cannot light anything the declared lights do not already light. The word is the one the CPU
 * knows, read once for the image (`PreExposure.exposure`), in the units of the light the lighting
 * traces. The image's pre-exposure is fixed here (`beginPreExposure`), before any pass writes
 * light: the number every light is written multiplied by, and the scale the composition multiplies
 * the image by until the GPU has measured the image's own (`../../post/exposure/meter.ts`) and
 * copied it over.
 */
function writeExposureWords(rt: WebgpuPagesRuntime) {
  const pre = beginPreExposure(rt)
  directParams[3] = pre.exposure
  directParams[DIRECT_AT.preExposure] = pre.now
  directParams[DIRECT_AT.shown] = pre.shown
}
/** The tables the lights read, written into the light buffer as they are ready: the skin's and the subsurface profiles'. */
function followLitTables(rt: WebgpuPagesRuntime, device: GPUDevice, buffer: GPUBuffer) {
  followSkinTable(rt, device, buffer)
  followSubsurfaceProfiles(rt, device, buffer)
}
/** Camera world position, reused from one image to the next: bounce allocates nothing. */
const viewpoint = new Float64Array(3)
/** The direction an orthographic camera looks along (`orthographic`), which the probes' distance to the camera is measured along. */
const viewForward = new Float64Array(3)
let orthographic = false
/** What the image drew, for the probes' marks, refilled each image. */
const drawn = createMarkSurface()

/** The surfaces the image drew — depth, the view's uniform and its size — and the screen probes it cast, for the marks of the cells it
 *  reads (`lighting/bounce/pool/pool.ts`); with no opaque surface drawn nothing of those, only the translucent surfaces' mark where the image
 *  prepared transparents, which needs no opaque depth; none where there is nothing to mark. */
function drawnSurface(rt: WebgpuPagesRuntime, device: GPUDevice, prepared: boolean) {
  const { gpu, run } = rt
  const opaque = run.depthDrawn && !!gpu.depthView && !!gpu.deferred
  drawn.translucent = radianceMarker(rt, device, prepared)
  if (!opaque && !drawn.translucent) return undefined
  drawn.depth = opaque ? gpu.depthView : undefined
  drawn.view = opaque ? gpu.deferred!.uniform : undefined
  drawn.size[0] = gpu.targetSize[0]
  drawn.size[1] = gpu.targetSize[1]
  drawn.probes = opaque ? lastCastProbes(gpu.screenProbes) : undefined
  drawn.markers = opaque ? translucencyGiMarkers(rt, 'shared') : NO_MARKERS
  return drawn
}

/** The parameters deferred resolve rereads, but for the light count and the grid's tiles. */
function fillDirectParams(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  environment: WebgpuPagesRuntime['lights']['store']['environment'],
) {
  directParams.fill(0)
  writeExposureWords(rt)
  directParams[4] = environmentCurve(environment)
  // The eye itself, under any projection: an orthographic camera's view point is a direction.
  directParams.set(cam.eye, 5)
  directParams[DIRECT_AT.alpha] = readFilmSetting(rt, 'propagateAlpha') ? 1 : 0
  directParams[DIRECT_AT.sharpness] = tonemapperSharpness(
    readFilmSetting(rt, 'tonemapperSharpen'),
    environmentSharpness(environment),
  )
}

/** The air of this image, between the light buffer and the surface cards: the sky's requests, the clouds'
 *  shadow maps, the atmosphere's tables and haze volume, then the sky light's capture over them. Returns
 *  whether the atmosphere was encoded. */
function encodeAir(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProjection: ArrayLike<number>,
  inverseViewProjection: ArrayLike<number>,
) {
  requestSkyAir(rt, device)
  encodeCloudShadow(rt, device, encoder, cam)
  const air = encodeAtmosphere(rt, device, encoder, cam, viewProjection, inverseViewProjection)
  encodeSkyCapture(rt, device, encoder)
  return air
}

/** A view that lists no light: the scene's lights are followed as far as they exist. The world's
 *  change boxes stay for the first lit frame's plan. Returns whether the atmosphere was encoded. */
function encodeUnlitView(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProjection: ArrayLike<number>,
  inverseViewProjection: ArrayLike<number>,
) {
  const {
    lights,
    lights: { store },
  } = rt
  // A lit view with no lamp may still hold an environment: its irradiance goes to the GPU.
  if (!store.unlit) uploadSceneLights(device, lights)
  if (lights.buffer) followLitTables(rt, device, lights.buffer)
  const air = encodeAir(rt, device, encoder, cam, viewProjection, inverseViewProjection)
  lightSurfaceCards(rt, device, encoder, cam, viewProjection)
  return air
}

/** The light grid's buffer at this image's size. */
function ensureLightGrid(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    { tiles } = lights,
    [width, height] = rt.gpu.targetSize
  if (lights.buffer)
    tiles?.ensure(
      width,
      height,
      lights.buffer,
      readHizSetting(rt, 'lightGridMaxCulledLightsPerCell'),
      readHizSetting(rt, 'lightGridLinkedLists'),
    )
}

/**
 * Direct lighting of an image, in order: the virtual shadow maps' CPU plan, the light buffer, the per-tile
 * light lists (cut by the depth pyramid this image built), the virtual shadow maps' GPU work
 * (`../../lighting/shadows/vsm/frame/vsmEncode.ts`), the air (the sky's requests, the clouds' shadow maps,
 * the atmosphere's tables, which read this image's shadow pages, and the sky light's capture over them), the
 * surface cache's lighting, which reads the air, bounce, then
 * the parameters deferred resolve will reread. A scene with no declared light launches neither
 * shadows nor lists: it pays nothing, and the unlit view outputs its raw albedo. Returns whether the
 * atmosphere was encoded. `prepared`: the transparents were prepared this image (`prepareBlend`), which the radiance cache's mark draws.
 */
export function encodeDirectLights(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProjection: ArrayLike<number>,
  inverseViewProjection: ArrayLike<number>,
  prepared: boolean,
) {
  const { lights } = rt,
    { store } = lights
  const active = store.count
  lights.lightsActive = active
  // The meshes' distance fields and the global field, before any pass that reads them.
  encodeDistanceFields(rt, device, encoder, cam, heldSkyLight(rt))
  // The cards of the meshes captured into their atlas, for the rays that read it (`lighting/surfaceCache/frame.ts`).
  encodeSurfaceCache(rt, device, encoder, cam)
  fillDirectParams(rt, cam, store.environment)
  // The unlit view reads neither light lists nor a shadow map: it therefore encodes none of them.
  // The world's change boxes wait: the first lit frame's invalidation stales its pages.
  // A view that is not lit (`ViewOverrides.lighting`) lists none either.
  if (!active || store.unlit || !rt.views.active.overrides.lighting) {
    return encodeUnlitView(rt, device, encoder, cam, viewProjection, inverseViewProjection)
  }
  // The light functions' indices are in the kind words before the buffer goes up.
  encodeLightFunctions(rt, device, encoder, cam)
  // The light profiles' slices likewise.
  encodeLightProfiles(rt, device)
  // The virtual shadow maps (`../../lighting/shadows/vsm/frame/`): the CPU plan gives every shadowed light its
  // projection record before the light buffer goes up; the GPU work follows the light lists, which the
  // per-pixel marking and the local lights' projection walk, and precedes the air and the lighting pass
  // that read the masks.
  planVsmFrame(rt, device, cam)
  // The buffer goes to the GPU before the per-tile lists: the blend pass reads it directly, without
  // tiles, and must stay lit even on a device that could not fit the lists.
  uploadSceneLights(device, lights)
  // Which lights this view draws, once, into their kind words: the light lists and the walks of every light read the bit.
  drawLights(
    device,
    lights.buffer,
    store,
    lights.drawn,
    lightDrawViewOf(cam, store, vsmMapSettings(rt).shadows),
  )
  if (lights.buffer) followLitTables(rt, device, lights.buffer)
  ensureLightGrid(rt)
  const listed = encodeTileLists(rt, device, encoder, viewProjection, cam)
  // Shadow pages of this image, which the air reads.
  encodeVsmFrame(rt, device, encoder, cam)
  // The air before the cards: their rays read the sky's light and the clouds' shade of this image, not the last.
  const air = encodeAir(rt, device, encoder, cam, viewProjection, inverseViewProjection)
  // The light of the cards' texels, which the rays of the bounce and of the reflections read, brought up to date by the lights just pushed.
  lightSurfaceCards(rt, device, encoder, cam, viewProjection)
  encodeBounce(rt, device, encoder, cam, prepared)
  // Kept bounce resources follow the placements even while bounce is toggled off.
  syncBouncePlacements(rt)
  if (listed) postListSizes(rt, active)
  return air
}

/** The lists' size, posted only when they were encoded. */
function postListSizes(rt: WebgpuPagesRuntime, active: number) {
  const { tiles } = rt.lights
  if (!tiles) return
  directParams[0] = active
  directParams[1] = tiles.tilesX
  directParams[2] = tiles.tilesY
  logFirstDirectFrame(rt)
}

/**
 * The surface cache's lighting for this image (`lighting/surfaceCache/lighting/frame.ts`): its direct light from the lights in their
 * buffer, its radiosity from the sky, the clouds' shade and the global distance field, its final light for every ray after.
 * The image's pre-exposure is the number the lights' rays are held relative to.
 */
function lightSurfaceCards(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProjection: ArrayLike<number>,
) {
  const lightFunction =
    lightFunctionResources(rt, 'lightFunctionBounce') ?? rt.gpu.deferred?.placeholders.lightFunction
  if (!lightFunction) return
  lightSurfaceCache(rt, device, encoder, {
    cam,
    viewProjection,
    viewPreExposure: directParams[DIRECT_AT.preExposure],
    sky: skyLightReadOf(rt),
    cloudShadow: cloudShadowOf(rt) ?? cloudShadowStandIn(device),
    lightFunction,
  })
}

/** The per-tile light lists of this image, which the demand pass and the resolve read: false when
 *  none could be encoded — no lists, no depth, or a device that could not fit them. */
function encodeTileLists(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  viewProjection: ArrayLike<number>,
  cam: EngineCamera,
) {
  const { lights, gpu } = rt,
    { tiles } = lights,
    [width, height] = gpu.targetSize
  // Sized at the image's start (`ensureLightGrid`); a buffer the lights' growth replaced since is bound
  // again by the pass.
  if (!tiles || !lights.buffer) return false
  tiles.update(viewProjection, cam.eye, width, height, lightGridCull(rt, device, cam))
  return tiles.encode(encoder, rt.run.frame)
}

/** Light tiles of this image, which the blend pass rereads: zero tiles when no list was encoded,
 *  never those of another image. */
export const directTiles = () => directParams

/**
 * An irradiance-probe batch, when there is work. The grid rereads the light buffer that was just
 * pushed, so bounce follows a moving light without one extra image of lag. A scene where nothing
 * changed and whose grid is converged encodes nothing at all: the Bounce stage is then "unmeasured",
 * never zero.
 */
function encodeBounce(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  prepared: boolean,
) {
  const { bounce, lights } = rt
  // A light exists: that is the signal that rigs the bounce, once.
  ensureBounce(rt, device)
  const probes = bounce.wanted ? bounce.probes : undefined
  bounce.probesUpdated = 0
  bounce.queued = undefined
  bounce.historyLost = false
  // The irradiance diagnostic view outputs raw values: composition skips ACES and sRGB.
  rt.gpu.deferred?.setRawOutput(lights.store.lightingView === 'bounce')
  if (!probes) return void releaseTranslucencyCache(bounce)
  syncBouncePlacements(rt)
  // The sky light their rays reach is captured this image, before the cards (`encodeSkyCapture`): the probes wait only while no cube of it is ready.
  if (skyLightPending(rt)) return
  // The store revision rises as soon as a light is added, set or removed: that is the signal the
  // grid needs to restart, and it costs no read. A change of fog alone is not one.
  // The light functions the bounce's lights wear are light transport too: the atlas changed, or the bounce began or
  // stopped reading it (`lightFunctionBounce`), and the probes are traced again.
  const functions = lightFunctionRevision(rt, 'lightFunctionBounce')
  if (bounce.lightEpoch !== lights.store.transportEpoch || bounce.lightFunctions !== functions) {
    bounce.lightEpoch = lights.store.transportEpoch
    bounce.lightFunctions = functions
    probes.restart()
    restartTranslucencyCache(bounce)
  }
  followGlobalLighting(rt, probes)
  // Camera world position, posted by image entry: the levels re-centre on it by cell step. No
  // allocation. What the image draws tells which cells it reads (`drawnSurface`): a pivoting camera
  // marks the cells it turns to.
  viewpoint.set(cam.eye)
  orthographic = cam.viewPoint[3] === 0
  for (let axis = 0; axis < 3; axis++) viewForward[axis] = -cam.viewPoint[axis]
  // The cache and the levels follow it now, before the screen probes and the reflections read them, whenever the pass is encoded.
  probes.track(viewpoint, cachedLightingPreExposureOf(rt))
  // The rays marched through the field read the surface cache at their hits: it is made for the images to come.
  demandSurfaceCache(rt)
  const queued: QueuedBounce = {
    reads: surfaceHitReads(rt, device),
    rays: sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame),
    surface: drawnSurface(rt, device, prepared),
  }
  // An image that casts screen probes marks the cells its own probes stand in: the pass waits for their placement, and the radiance
  // cache's update that follows it fills every cell they read before they read it (`encodeQueuedBounce`, in the pre-light step).
  if (screenProbesCast(rt)) bounce.queued = queued
  else encodeBouncePass(rt, encoder, queued)
}

/** The image's probe pass, into `encoder`: the cells marked from the probes the image placed (`placed`), else from what `drawnSurface`
 *  named. */
function encodeBouncePass(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  { reads, rays, surface }: QueuedBounce,
  placed?: MarkProbes,
) {
  const { bounce } = rt,
    probes = bounce.probes!
  if (surface && placed) surface.probes = placed
  // The sky the pass's rays reach is the one the image holds when it is encoded, the one its screen probes read.
  probes.encode(
    encoder,
    viewpoint,
    skyLightReadOf(rt),
    reads,
    cachedLightingPreExposureOf(rt),
    surface,
    rays,
    orthographic ? viewForward : undefined,
  )
  bounce.probesUpdated = probes.lastProbes
  // The volume's own cache is worked beside the world's, its cells marked against this image's depth as theirs are.
  encodeTranslucencyCache(rt, encoder, {
    reads,
    rays,
    viewpoint,
    forward: orthographic ? viewForward : undefined,
  })
}

/** The probe pass the image waited with (`encodeBounce`), encoded now that its screen probes are placed: from the cells of the probes
 *  `placed`, or, where they placed none, of the last image's. Nothing where the image waited with none. */
export function encodeQueuedBounce(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  placed?: MarkProbes,
) {
  const { bounce } = rt,
    { queued } = bounce
  if (!queued) return
  bounce.queued = undefined
  encodeBouncePass(rt, encoder, queued, placed)
}

/** Configuration of the first image lit by the contract, logged once. */
function logFirstDirectFrame(rt: WebgpuPagesRuntime) {
  const { lights, diag } = rt
  if (lights.firstFrameLogged) return
  lights.firstFrameLogged = true
  diag.engineDiagnostic('direct-lighting-frame', 'First image lit by the contract', {
    version: 1,
    tiles: [lights.tiles?.tilesX ?? 0, lights.tiles?.tilesY ?? 0],
    ...directLightingState(rt),
  })
}

/** Direct-lighting state, as the image and tracking diagnostics publish it. */
export function directLightingState(rt: WebgpuPagesRuntime) {
  const { lights } = rt
  return {
    contractLights: lights.lightsActive,
    view: lights.store.lightingView,
    unlit: lights.store.unlit,
    unavailable: lights.shadowReason,
  }
}
