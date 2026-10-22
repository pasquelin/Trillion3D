import { NO_INDEX } from '../../../../math/src/constants.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { cloudSeparatesAir, type CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import { cloudsInView, cloudSetupOf } from '../../modules/sky/clouds/cloudModes.ts'
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
import {
  vsmConsumerResources,
  vsmOrStandIns,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import { viewProj } from '../backend/helpers.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { airRequests, airShapeOfRuntime, atmosphereDeclared } from './airState.ts'
import { writeAirlessFrame } from './airlessFrame.ts'
import { encodeOpaqueHaze, encodeSky } from './encodeAtmosphere.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { directTiles } from './encodeLights.ts'
import { followSkyModule, skyStateOf, sunChannelOf } from './encodeCloudsSky.ts'
import { requestSkyAir as askSkyLightAir } from './encodeSkyLight.ts'
import { cloudTraceFrameOf } from './skyModuleGate.ts'

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
  return part && cloudsInView(part.settings, false) ? part : undefined
}

/** Whether the clouds of the last image of this view change over time with nothing else moving: they
 *  drift with the wind, a storm flashes, and a cut leaves the rebuilding unfinished. A held frame
 *  would freeze them. */
export function cloudsMoved(rt: WebgpuPagesRuntime) {
  const view = rt.gpu.clouds
  if (!view?.last.drawn) return false
  const part = drawnPart(rt)
  if (!part) return false
  const { wind, stormAmount } = part.material
  const drifts = (wind[0] !== 0 || wind[1] !== 0 || wind[2] !== 0) && wind[3] !== 0
  return drifts || stormAmount !== 0 || view.last.images < SETTLE_IMAGES
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
  const scales = [0, 1].map((index) => {
    const light = lights.store.atmosphereLight(index)
    return light ? cloudShadowOfLight(light).cloudScatteredLuminanceScale : WHITE
  })
  const tiles = directTiles()
  const image: CloudTraceImage = {
    inverseView: invertMatrix4(inverse, cam.viewProjection),
    view: { width: gpu.targetSize[0], height: gpu.targetSize[1] },
    frameIndex: rt.run.frame,
    time,
    airPresent: !airless,
    lightScales: [scales[0], scales[1]],
    viewProjection: viewProj,
    lightGridCells: [tiles[1], tiles[2]],
    sunShadowChannel: channel === NO_INDEX ? undefined : channel,
    preExposure: preExposureOf(rt).now,
  }
  return image
}

/** The view's clouds, and the images kept from the last image: made on the first ask. */
function viewOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  return (rt.gpu.clouds ??= createCloudViewGpu(device))
}

/** Whether this image continues the view's last: not after a cut of the camera, a change of the
 *  sizes or of the images' kind, nor when the last image drew no cloud or left no reconstructed
 *  image to read. Counts the images since the cut. */
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
  const setup = cloudSetupOf(part.quality, true, perspective)
  const maps = vsmOrStandIns(vsmConsumerResources(rt), deferred.placeholders)
  const first = lights.store.atmosphereLight(0)
  const channel = sunChannelOf(rt, !!vsmConsumerResources(rt) && !!first?.castsShadow)
  const frame = cloudTraceFrameOf(first, channel !== NO_INDEX, false, false, airless)
  const tiles = lights.tiles && directTiles()[0] > 0 ? lights.tiles : undefined
  const asked = cloudTraceKey(part.quality, frame, setup)
  const key = { ...asked, localLights: asked.localLights && !!tiles }
  const shape = airless ? airShapeOfRuntime(rt) : gpu.atmosphere!.shape
  const programs = cloudViewProgramsOf(device, shape, (error) =>
    rt.diag.diagnosticFailure('cloud-program-failed', error),
  )
  const hazed = cloudHazeInSecondPass(part.quality, !airless)
  if (!cloudProgramsReady(programs, setup, key, hazed)) return undefined
  return { setup, maps, channel, key, programs, tiles }
}

/** The sky where no surface was drawn and the haze on the surfaces (`air`: the image shows an
 *  atmosphere), then the clouds over them. */
export function encodeSkyAndClouds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  air: boolean,
) {
  if (air) {
    encodeSky(rt, encoder)
    encodeOpaqueHaze(rt, encoder)
  }
  encodeClouds(rt, device, encoder, cam, air)
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
  const sizes = `${allocated.width}x${allocated.height}|${size.width}x${size.height}`
  const cut = !continues(rt, sizes, made.setup.mode.reconstructs)
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
    hdr: hdrView,
    air: {
      lights: lights.buffer,
      ...air,
      fog: gpu.fogVolume?.read ?? deferred.placeholders.fog,
    },
    material: entries,
    noise: made.maps.noise,
    extra: {
      maps: made.key.opaqueShadow ? made.maps : undefined,
      tileLights: made.tiles?.buffer,
      skyLight: made.key.skyLight ? skyLightReadOf(rt) : undefined,
    },
    hazeMaps: { maps: made.maps, cloudShadow: cloudShadowOf(rt) ?? cloudShadowStandIn(device) },
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
  const frame = frameOf(rt, device, encoder, cam, part, stands)
  if (frame) encodeCloudView(frame)
  const view = rt.gpu.clouds
  if (!view) return
  view.last.drawn = !!frame
  if (frame) view.last.preExposure = preExposureOf(rt).now
}
