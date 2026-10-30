import { NO_INDEX } from '../../../../math/src/constants.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { cloudSeparatesAir, type CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import {
  cloudDebugSetup,
  cloudsInView,
  cloudSetupOf,
  type CloudSetup,
} from '../../modules/sky/clouds/cloudModes.ts'
import { shownHeightFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import { cloudHistoryKey, drawnPartOf } from '../../modules/sky/clouds/drawnPart.ts'
import { advanceCloudView } from '../../modules/sky/clouds/reconstruct.ts'
import { cloudTraceKey } from '../../modules/sky/clouds/traceExtraLayout.ts'
import { cloudHazeInSecondPass } from '../../modules/sky/clouds/traceOptions.ts'
import type { CloudTraceImage } from '../../modules/sky/clouds/traceLayout.ts'
import type { CloudViewFrame } from '../../modules/sky/clouds/viewGroups.ts'
import { cloudViewProgramsOf } from '../../modules/sky/clouds/viewPrograms.ts'
import { cloudProgramsReady, encodeCloudView } from '../../modules/sky/clouds/viewResolve.ts'
import { createCloudViewGpu, disposeCloudView } from '../../modules/sky/clouds/viewTargets.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import { skyLightReadOf } from './skyLightState.ts'
import { fogHoldout, holdoutOn } from '../prepare/alphaHoldout.ts'
import {
  vsmConsumerResources,
  vsmOrStandIns,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { measureBeforeTranslucency } from '../../post/taa/frame.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import { viewProj } from '../backend/helpers.ts'
import { noiseFrame } from './noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { skyDrawn } from './skyRoots.ts'
import { airRequests, airShapeOfRuntime, atmosphereDeclared } from './airState.ts'
import { writeAirlessFrame } from './airlessFrame.ts'
import { atmosphereHoldout, encodeOpaqueHaze, encodeSky } from './encodeAtmosphere.ts'
import { encodeHeightFog } from './encodeHeightFog.ts'
import {
  encodeSeparateFog,
  finishSeparateFog,
  planSeparateFog,
  separateFogTarget,
} from './encodeFogSeparate.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { directTiles } from './encodeLights.ts'
import { followSkyModule, skyStateOf, sunChannelOf } from './encodeCloudsSky.ts'
import { requestSkyAir as askSkyLightAir } from './encodeSkyLight.ts'
import { cloudTraceFrameOf } from './skyModuleGate.ts'
import { fogReadOf } from './localFogGpu.ts'
import { waterWanted } from '../../blend/water/waterTargets.ts'
import { waterViewOf } from '../../blend/water/waterView.ts'

/**
 * THE CLOUDS IN THE VIEW'S IMAGE, drawn after the sky and the haze on the surfaces and before the
 * transparents: the scene's depth range, the trace, the haze per pixel where it is asked, the
 * reconstruction from the last image and the composition over the lit image
 * (`../../modules/sky/clouds/viewResolve.ts`), in the order of the reference's volumetric clouds
 * and their render target. Each view keeps its own images and history (`WebgpuGpuState.clouds`).
 * A view whose sky has no clouds part, that keeps them out of the main view (`inMainView`), whose
 * image shows no lit scene, or whose atmosphere is not drawn yet, draws none, makes none and
 * releases what it made. The clouds stand on the atmosphere's tables where there is one, else on
 * the stand-in air of a scene with none (`cloudAirOf`): the light's own illuminance, no haze.
 */

/** The images after a cut a still camera needs before its clouds hold: the longest cycle of the
 *  four modes (a trace of one pixel in sixteen) and the frames of noise it is read at. */
const SETTLE_IMAGES = 24

const inverse = new Float64Array(16)
const WHITE = [1, 1, 1]

/** The sky module followed (`followSkyModule`), then what the sky light and the clouds ask of the
 *  air: the volumes of the haze apart, where the clouds' haze starts on the cloud past 0 kilometres
 *  (`cloudSeparatesAir`). Written each image, ahead of the encoding of the air. */
export function requestSkyAir(rt: WebgpuPagesRuntime, device: GPUDevice) {
  followSkyModule(rt, device)
  askSkyLightAir(rt)
  const part = drawnPart(rt)
  if (part && cloudSeparatesAir(part.settings)) airRequests(rt).separate = true
}

/** The clouds part this view draws, none where the module has none or keeps them out of the view. */
function drawnPart(rt: WebgpuPagesRuntime): CloudPart | undefined {
  const part = skyStateOf(rt)?.sky?.clouds
  if (!part || !cloudsInView(part.settings, false)) return undefined
  return drawnPartOf(part, holdoutOn(rt))
}

/** Whether the clouds of the last image of this view change over time with nothing else moving: they
 *  drift with the wind by the world's clock — a paused world drifts none: the clock must have moved
 *  since the last image drawn —, a storm flashes, and a cut leaves the rebuilding unfinished. A held
 *  frame would freeze them. */
export function cloudsMoved(rt: WebgpuPagesRuntime) {
  const view = rt.gpu.clouds
  if (!view?.last.drawn) return false
  const part = drawnPart(rt)
  if (!part) return false
  const { wind, stormAmount } = part.material
  const drifts = (wind[0] !== 0 || wind[1] !== 0 || wind[2] !== 0) && wind[3] !== 0
  const clockMoved = rt.run.graphClocks.time !== view.last.time
  return (drifts && clockMoved) || stormAmount !== 0 || view.last.images < SETTLE_IMAGES
}

/** What the clouds of this image stand on: `air`, the atmosphere's tables built this image (`air`
 *  true); `airless`, the stand-in air of a scene with no atmosphere (or one the quality settings turn
 *  off); none where an atmosphere is on and not drawn yet, or the image shows no lit scene. */
function cloudAirOf(rt: WebgpuPagesRuntime, air: boolean) {
  if (air) return 'air' as const
  return atmosphereDeclared(rt) || !litImageShown(rt) ? undefined : ('airless' as const)
}

/** The image's values the trace block is written from. */
function imageOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  time: number,
  channel: number,
  airless: boolean,
) {
  const { gpu, lights } = rt
  const first = lights.store.atmosphereLight(0),
    second = lights.store.atmosphereLight(1)
  const tiles = directTiles()
  const image: CloudTraceImage = {
    inverseView: invertMatrix4(inverse, cam.viewProjection),
    view: { width: gpu.targetSize[0], height: gpu.targetSize[1] },
    frameIndex: noiseFrame(rt),
    time,
    airPresent: !airless,
    lightScales: [
      first ? cloudShadowOfLight(first).cloudScatteredLuminanceScale : WHITE,
      second ? cloudShadowOfLight(second).cloudScatteredLuminanceScale : WHITE,
    ],
    viewProjection: viewProj,
    lightGridCells: [tiles[1], tiles[2]],
    sunShadowChannel: channel === NO_INDEX ? undefined : channel,
    preExposure: preExposureOf(rt).now,
    exposure: preExposureOf(rt).exposure,
  }
  return image
}

/** The view's clouds, and the images kept from the last image: made on the first ask. */
function viewOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  return (rt.gpu.clouds ??= createCloudViewGpu(device))
}

/** Whether this image continues the view's last: not after a cut of the camera, a change of the
 *  allocated size or of the images' kind, nor when the last image drew no cloud or left no
 *  reconstructed image to read; a change of the drawn size alone keeps the history (each image
 *  holds the part of its texture it filled). Counts the images since the cut. */
function continues(rt: WebgpuPagesRuntime, key: string, rebuilds: boolean) {
  const view = rt.gpu.clouds!,
    { last, state } = view
  const revision = rt.run.gate.temporalRevision
  const same = revision === last.revision && key === last.sizes && last.drawn
  last.revision = revision
  last.sizes = key
  const continued = same && (!rebuilds || !!view.reconstructedAt(state.current))
  last.images = continued ? last.images + 1 : 1
  return continued
}

/** Whether the clouds of this image hold anything out of the alpha, where the alpha holdout is in effect: the
 *  clouds themselves (`alphaHole`), or the haze of the air and the fog in front of them, which hold out
 *  (`SceneAtmosphere.holdout`, `SceneHeightFog.holdout`). As the reference does it, for the clouds traced one
 *  pixel to a pixel (the fourth mode) alone, never for a direct trace, and not where the clouds go into the fog's own texture. */
function cloudsHoldOut(rt: WebgpuPagesRuntime, part: CloudPart, setup: CloudSetup) {
  if (!holdoutOn(rt) || setup.direct || setup.mode.index !== 3 || separateFogTarget(rt))
    return false
  const sky = !!rt.gpu.atmosphere && atmosphereHoldout(rt)
  const fog = fogHoldout(rt, shownHeightFog(rt.lights.store.environment?.fog))
  return part.settings.alphaHole || sky || fog
}

/** The programs this image needs, compiled or asked, and the options their key says: none until
 *  all are compiled. */
function programsOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  part: CloudPart,
  perspective: boolean,
  airless: boolean,
) {
  const { gpu, lights } = rt,
    deferred = gpu.deferred!
  const traced = cloudSetupOf(part.quality, true, perspective)
  const maps = vsmOrStandIns(vsmConsumerResources(rt), deferred.placeholders)
  const first = lights.store.atmosphereLight(0)
  const channel = sunChannelOf(rt)
  const frame = cloudTraceFrameOf(first, channel !== NO_INDEX, airless)
  const tiles = lights.tiles && directTiles()[0] > 0 ? lights.tiles : undefined
  const asked = cloudTraceKey(part.quality, frame, traced, part.material)
  const setup = asked.debugView === 0 ? traced : cloudDebugSetup(traced)
  // A debug view of the tracing holds nothing out of the alpha.
  const holdout = asked.debugView === 0 && cloudsHoldOut(rt, part, setup)
  const key = { ...asked, localLights: asked.localLights && !!tiles, holdout }
  const shape = airless ? airShapeOfRuntime(rt) : gpu.atmosphere!.shape
  const programs = cloudViewProgramsOf(device, shape, (error) =>
    rt.diag.diagnosticFailure('cloud-program-failed', error),
  )
  const hazed = cloudHazeInSecondPass(part.quality, !airless)
  const corners = part.quality.cloudEmptySpaceSkippingCorners
  if (!cloudProgramsReady(programs, setup, key, hazed, corners, !!waterWanted(rt))) return undefined
  return { setup, maps, channel, key, programs, tiles }
}

/** Whether the sky, the fog, the haze and the clouds wait for the single-layer water: it is shaded over the image and the camera is not under
 *  it. A camera under the water has them laid before it, the water shaded over them. */
const holdsForWater = (rt: WebgpuPagesRuntime) => waterViewOf(rt).stage === 'after'

/** What the image lays over the lit image after the single-layer water, held until then (`encodeAfterWater`): by image, none once played. */
const afterWater = new WeakMap<WebgpuPagesRuntime, { lay: () => void; finish: () => void }>()

/** The sky where no surface was drawn, the fog and the haze, in the order of the image. With no separate fog: the sky, the fog over the lit image and the sky, then the haze.
 *  In the fog's textures (`separate`) the atmosphere is one pass ahead of the fog: the sky is drawn only where a dome was drawn (`dome`); else the textures come first and the
 *  sky is drawn over the image whole, the fog laid over it afterwards (`finishSeparateFog`). */
function layAtmosphere(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  air: boolean,
  separate: ReturnType<typeof planSeparateFog>,
  dome: boolean,
) {
  if (!separate) {
    if (air && !dome) encodeSky(rt, encoder)
    encodeHeightFog(rt, encoder, air)
    if (air) encodeOpaqueHaze(rt, encoder)
    return
  }
  const fogFirst = air && !dome
  if (fogFirst) encodeSeparateFog(rt, encoder)
  if (air) {
    // The sky pixels are the dome's where one was drawn: the atmosphere draws none of its own there.
    if (!dome) encodeSky(rt, encoder)
    encodeOpaqueHaze(rt, encoder)
  }
  if (!fogFirst) encodeSeparateFog(rt, encoder)
}

/** The sky where no surface was drawn (`air`: the image shows an atmosphere), the fog over the lit image
 *  and the sky, the haze marched on the surfaces (`air` again), then the clouds over them. The temporal pass measures the
 *  lit image first (`measureBeforeTranslucency`), before any of them lies on it. Where the single-layer water is shaded over
 *  the image (`waterWanted`), the clouds are traced here but the sky, the fog, the haze and the clouds' composition wait for the water,
 *  which is shaded over the lit image unfogged and without sky, as the reference orders them (`encodeAfterWater`). */
export function encodeSkyAndClouds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  air: boolean,
) {
  if (rt.gpu.hdrView) measureBeforeTranslucency(rt, encoder, rt.gpu.hdrView)
  // The fog drawn into textures of its own is composed over the image with the sky and the haze in it where the sky pass drew a dome
  // (the scene has a sky material for this view), else before them (`lay`), so the share of the image its scattering takes holds them or
  // not, and is laid over the image once the clouds are in it (`finishSeparateFog`).
  const separate = planSeparateFog(rt, device, cam, air)
  const dome = skyDrawn(rt)
  const water = holdsForWater(rt)
  // An image's held work never outlives it: one an earlier image left unplayed is dropped here.
  afterWater.delete(rt)
  if (water)
    afterWater.set(rt, {
      lay: () => layAtmosphere(rt, encoder, air, separate, dome),
      finish: () => finishSeparateFog(rt, encoder),
    })
  else layAtmosphere(rt, encoder, air, separate, dome)
  encodeClouds(rt, device, encoder, cam, air)
  if (!water) finishSeparateFog(rt, encoder)
}

/** The composition of the clouds the image held back for the water (none where it held none), encoded now: over the image the water was
 *  shaded over, `water` the texture whose alpha marks the water's pixels, none where it drew none. */
function composeDeferredClouds(rt: WebgpuPagesRuntime, water?: GPUTextureView) {
  const view = rt.gpu.clouds
  const held = view?.deferred
  if (!view || held?.stage !== 'water') return
  view.deferred = undefined
  held.compose(water)
}

/** The debug view of the cloud tracing (`cloudDebugView`), laid over the lit image once the translucent surfaces are drawn: the
 *  composition the view held back, encoded now, once. Nothing where the view has no debug view. */
export function encodeCloudDebugView(rt: WebgpuPagesRuntime) {
  const view = rt.gpu.clouds
  const held = view?.deferred
  if (!view || held?.stage !== 'translucency') return
  view.deferred = undefined
  held.compose()
}

/** What the image held back for the water, in the reference's order after it: the sky, the fog, the haze, then the clouds' composition
 *  (`water` as `composeDeferredClouds` has it). Nothing where nothing was held, so the stage that finds the water done and the one
 *  that closes the image can both call it: it plays once. */
export function encodeAfterWater(rt: WebgpuPagesRuntime, water?: GPUTextureView) {
  const held = afterWater.get(rt)
  if (held) {
    afterWater.delete(rt)
    held.lay()
  }
  composeDeferredClouds(rt, water)
  held?.finish()
}

/** The air an image of the clouds reads, over `stands` (`cloudAirOf`): the atmosphere's tables and
 *  frame, or the stand-in air of a scene with none, its frame written for this image; none while
 *  the atmosphere's programs are not compiled. */
function airOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  part: CloudPart,
  stands: 'air' | 'airless',
) {
  const { atmosphere } = rt.gpu
  if (stands === 'air')
    return atmosphere?.ready
      ? { frame: atmosphere.frameBuffer, ...atmosphere.tables, volumes: atmosphere.volumes }
      : undefined
  return writeAirlessFrame(rt, device, cam, part.settings.planetRadiusKm)
}

/** What an image of `part` is made from, none where the view cannot draw the clouds yet: the
 *  material's textures not generated, the air's or the lit image's passes not ready, a program not
 *  compiled. The view's history moves on only for an image that draws. */
function frameOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  part: CloudPart,
  stands: 'air' | 'airless',
): CloudViewFrame | undefined {
  const { gpu, lights, run } = rt,
    state = skyStateOf(rt)
  const entries = state?.material?.entries
  const { hdrView, depthView, deferred } = gpu
  if (!entries || !hdrView || !depthView || !deferred || !lights.buffer) return undefined
  if (!run.depthDrawn) return undefined
  const air = airOf(rt, device, cam, part, stands)
  if (!air) return undefined
  const airless = stands === 'airless'
  const made = programsOf(rt, device, part, cam.perspective !== 0, airless)
  if (!made) return undefined
  const view = viewOf(rt, device)
  const allocated = { width: gpu.allocatedSize[0], height: gpu.allocatedSize[1] }
  const size = { width: gpu.targetSize[0], height: gpu.targetSize[1] }
  const cut = !continues(
    rt,
    cloudHistoryKey(allocated, made.key.debugView),
    made.setup.mode.reconstructs,
  )
  // The clouds' shade this image: the maps built, or the stand-in that shades nothing.
  const shade = cloudShadowOf(rt) ?? cloudShadowStandIn(device)
  const separate = separateFogTarget(rt)
  return {
    device,
    encoder,
    programs: made.programs,
    gpu: view,
    part,
    setup: made.setup,
    key: made.key,
    plan: advanceCloudView(view.state, allocated, size, cut, made.setup),
    image: imageOf(rt, cam, state!.clock(), made.channel, airless),
    camera: cam,
    allocated,
    view: size,
    preExposureRatio: preExposureOf(rt).now / view.last.preExposure,
    sceneDepth: depthView,
    // The fog drawn into textures of its own takes the clouds in its first level, not the lit image.
    hdr: made.key.debugView === 0 ? (separate ?? hdrView) : hdrView,
    air: {
      lights: lights.buffer,
      ...air,
      fog: fogReadOf(rt) ?? deferred.placeholders.fog,
    },
    material: entries,
    noise: made.maps.noise,
    extra: {
      startDistance: made.key.emptySpace ? view.emptySpaceTable.view : undefined,
      maps: made.key.opaqueShadow ? made.maps : undefined,
      tileLights: made.tiles?.buffer,
      skyLight: made.key.skyLight ? skyLightReadOf(rt) : undefined,
      cloudShadow: made.key.volumeShadowMap ? shade : undefined,
    },
    hazeMaps: { maps: made.maps, cloudShadow: shade },
  }
}

/**
 * The clouds of the image over `rt`'s lit image, on `encoder`: after the sky and before the
 * transparents. Nothing is made, encoded or kept where the view draws no cloud or its atmosphere is
 * not drawn yet. The image waits (no cloud, the history untouched) for the programs it needs to be
 * compiled and for the material's textures to be generated.
 */
function encodeClouds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  air: boolean,
) {
  const part = drawnPart(rt)
  const stands = cloudAirOf(rt, air)
  if (!part || !stands) return disposeCloudView(rt.gpu)
  // What the translucent surfaces read of the clouds is this image's, left by its encoding.
  if (rt.gpu.clouds) rt.gpu.clouds.shown = rt.gpu.clouds.deferred = undefined
  const frame = frameOf(rt, device, encoder, cam, part, stands)
  const debug = !!frame && frame.key.debugView !== 0
  // Where the single-layer water is shaded over the image and the camera is not under it, the clouds are composed after it (`composeDeferredClouds`);
  // a debug view of the tracing, after the translucent surfaces (`encodeCloudDebugView`).
  const composition = frame ? encodeCloudView(frame, debug || holdsForWater(rt)) : undefined
  const view = rt.gpu.clouds
  if (!view) return
  if (composition)
    view.deferred = debug
      ? { stage: 'translucency', compose: composition.compose }
      : { stage: 'water', ...composition }
  view.last.drawn = !!frame
  if (frame) {
    view.last.preExposure = preExposureOf(rt).now
    view.last.time = rt.run.graphClocks.time
  }
}
