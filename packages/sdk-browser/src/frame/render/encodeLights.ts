import type { EngineCamera } from '../../camera/engineCamera.ts'
import {
  environmentCurve,
  environmentSharpness,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import {
  readFilmSetting,
  tonemapperSharpness,
} from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { appliedExposureOf } from '../../post/exposure/applied.ts'
import { beginPreExposure } from '../../post/exposure/pre.ts'
import { DIRECT_AT } from '../../lighting/deferred/view.ts'
import { uploadSceneLights } from '../backend/state/lightBuffer.ts'
import { ensureBounce, syncLightingProxies } from '../prepare/bounce.ts'
import { createMarkSurface } from '../../lighting/bounce/marks.ts'
import { planVsmFrame } from '../../lighting/shadows/vsm/frame/vsmPlan.ts'
import { encodeVsmFrame } from '../../lighting/shadows/vsm/frame/vsmEncode.ts'
import { lightGridCull } from '../../lighting/tiles/cullView.ts'
import {
  encodeLightFunctions,
  lightFunctionResources,
  lightFunctionRevision,
} from '../../lighting/lightFunction/frame.ts'
import { encodeDistanceFields } from '../../lighting/distanceField/frame.ts'
import { heldSkyLight } from './skyLightHeld.ts'
import { skyLightPending, skyLightReadOf } from './encodeSkyLight.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The floats the deferred and blend passes reread: lights, tiles in X and Y, exposure, display
 *  curve, the eye the fog is measured from, the composition's sharpening strength, then the image's
 *  pre-exposure and the scale it is shown at (`PreExposure`). */
const directParams = new Float32Array(DIRECT_AT.words)
/**
 * The image's exposure words. Exposure is not a light: it sets conversion of radiance into an image,
 * and cannot light anything the declared lights do not already light. The word is the one the CPU
 * knows (`appliedExposureOf`), in the units of the light the lighting traces. The image's
 * pre-exposure is fixed here (`beginPreExposure`), before any pass writes light: the number every
 * light is written multiplied by, and the scale the composition multiplies the image by until the
 * GPU has measured the image's own (`../../post/exposure/meter.ts`) and copied it over.
 */
function writeExposureWords(rt: WebgpuPagesRuntime) {
  const pre = beginPreExposure(rt)
  directParams[3] = appliedExposureOf(rt)
  directParams[DIRECT_AT.preExposure] = pre.now
  directParams[DIRECT_AT.shown] = pre.shown
}
/** Camera world position, reused from one image to the next: bounce allocates nothing. */
const viewpoint = new Float64Array(3)
/** What the image drew, for the probes' marks, refilled each image. */
const drawn = createMarkSurface()

/** The surfaces the image drew — depth, normals, the view's uniform, its size, the camera that drew it
 *  and what it drew: the rows and the cut, whose revisions and counts are what the frame's hold reads
 *  (`../loop/signature.ts`) — for the marks of the cells it reads (`lighting/bounce/marks.ts`); none
 *  when no opaque surface was drawn: nothing to mark. */
function drawnSurface(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { gpu, run } = rt
  if (!run.depthDrawn || !gpu.depthView || !gpu.surfaces || !gpu.deferred) return undefined
  drawn.key = rt.views.active
  drawn.depth = gpu.depthView
  drawn.normals = gpu.surfaces.views()[1]
  drawn.view = gpu.deferred.uniform
  drawn.size[0] = gpu.targetSize[0]
  drawn.size[1] = gpu.targetSize[1]
  const { signature } = drawn,
    { rows } = rt.layout
  signature.set(cam.view, 0)
  signature.set(cam.projection, 16)
  signature[32] = rows.tableEpoch
  signature[33] = rows.rowsEpoch
  signature[34] = rows.packedCount
  signature[35] = rows.rowCount
  signature[36] = run.cutEpoch
  signature[37] = run.pageArrayEpoch
  signature[38] = run.visible
  signature[39] = run.selectedTriangles
  signature[40] = run.lodLevel
  return drawn
}

/**
 * Direct lighting of an image, in order: the virtual shadow maps' CPU plan, the light buffer,
 * bounce, the per-tile light lists (cut by the depth pyramid this image built), the virtual shadow maps' GPU work (`../../lighting/shadows/vsm/frame/vsmEncode.ts`), then
 * the parameters deferred resolve will reread. A scene with no declared light launches neither
 * shadows nor lists: it pays nothing, and the unlit view outputs its raw albedo.
 */
export function encodeDirectLights(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProjection: ArrayLike<number>,
) {
  const { lights } = rt,
    { store, tiles } = lights
  const active = store.count
  lights.lightsActive = active
  // The meshes' distance fields and the global field, before any pass that reads them.
  encodeDistanceFields(rt, device, encoder, cam, heldSkyLight(rt))
  const environment = store.environment
  directParams.fill(0)
  writeExposureWords(rt)
  directParams[4] = environmentCurve(environment)
  // The eye itself, under any projection: an orthographic camera's view point is a direction.
  directParams.set(cam.eye, 5)
  directParams[DIRECT_AT.sharpness] = tonemapperSharpness(
    readFilmSetting(rt, 'tonemapperSharpen'),
    environmentSharpness(environment),
  )
  // The unlit view reads neither light lists nor a shadow map: it therefore encodes none of them.
  // A representation change held for the camera to rest is released to the list now: the first
  // lit frame's invalidation stales its pages, whatever the camera does.
  // A view that is not lit (`ViewOverrides.lighting`) lists none either.
  if (!active || store.unlit || !rt.views.active.overrides.lighting) {
    lights.changes.releaseDeferred()
    // A lit view with no lamp may still hold an environment: its irradiance goes to the GPU.
    if (!store.unlit) uploadSceneLights(device, lights)
    return directParams
  }
  // The light functions' indices are in the kind words before the buffer goes up.
  encodeLightFunctions(rt, device, encoder, cam)
  // The virtual shadow maps (`../../lighting/shadows/vsm/frame/`): the CPU plan gives every shadowed light its
  // mask channel before the light buffer goes up; the GPU work follows the light lists, which the
  // per-pixel marking walks, and precedes the lighting pass that reads the mask.
  planVsmFrame(rt, device, cam)
  // The buffer goes to the GPU before the per-tile lists: the blend pass reads it directly, without
  // tiles, and must stay lit even on a device that could not fit the lists.
  uploadSceneLights(device, lights)
  // The light grid's buffer at this image's size before the bounce lists its world grid into it:
  // no pass of the image names a buffer the grid replaces later in it.
  const [width, height] = rt.gpu.targetSize
  if (lights.buffer) tiles?.ensure(width, height, lights.buffer, store.count)
  encodeBounce(rt, device, encoder, active, cam)
  // Kept bounce resources follow the placements even while bounce is toggled off.
  syncLightingProxies(rt)
  const listed = encodeTileLists(rt, device, encoder, viewProjection, cam)
  encodeVsmFrame(rt, device, encoder, cam)
  if (!listed || !tiles) return directParams
  directParams[0] = active
  directParams[1] = tiles.tilesX
  directParams[2] = tiles.tilesY
  logFirstDirectFrame(rt)
  return directParams
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
  // Sized before the bounce listed its world grid (`encodeDirectLights`); a buffer the world's growth
  // replaced since is bound again by the pass.
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
  active: number,
  cam: EngineCamera,
) {
  const { bounce, lights } = rt
  // A light exists: that is the signal that triggers the resident-proxy read, once.
  ensureBounce(rt, device)
  const probes = bounce.wanted ? bounce.probes : undefined
  bounce.probesUpdated = 0
  bounce.raysLaunched = 0
  bounce.encoded = false
  // The irradiance diagnostic view outputs raw values: bounce application reads it in the grid
  // uniform, and composition skips ACES and sRGB.
  const irradiance = lights.store.lightingView === 'bounce'
  rt.gpu.deferred?.setRawOutput(irradiance)
  if (!probes) return
  syncLightingProxies(rt)
  probes.setIrradianceView(irradiance)
  // The sky their rays reach is built a frame after the first one that asks (`encodeAtmosphere`).
  if (skyLightPending(rt)) return
  // The store revision rises as soon as a light is added, set or removed: that is the signal the
  // grid needs to restart, and it costs no read. A change of fog alone is not one. The sky is the
  // other: a ray that leaves the scene reads the table the atmosphere builds when its sun or its air
  // changes (`skyBuilds`), which no light's revision tells.
  const skyBuilds = rt.gpu.atmosphere?.skyBuilds ?? 0
  // The light functions the bounce's lights wear are light transport too: the atlas changed, or the bounce began or
  // stopped reading it (`lightFunctionBounce`), and the probes are traced again.
  const functions = lightFunctionRevision(rt, 'lightFunctionBounce')
  if (
    bounce.lightEpoch !== lights.store.transportEpoch ||
    bounce.skyBuilds !== skyBuilds ||
    bounce.lightFunctions !== functions
  ) {
    bounce.lightEpoch = lights.store.transportEpoch
    bounce.skyBuilds = skyBuilds
    bounce.lightFunctions = functions
    probes.restart()
  }
  // Camera world position, posted by image entry: the levels re-centre on it by cell step. No
  // allocation. What the image draws tells which cells it reads (`drawnSurface`): a pivoting camera
  // marks the cells it turns to.
  viewpoint.set(cam.eye)
  const atlas =
    lightFunctionResources(rt, 'lightFunctionBounce') ?? rt.gpu.deferred!.placeholders.lightFunction
  const shade = {
    sky: skyLightReadOf(rt),
    cloudShadow: cloudShadowOf(rt) ?? cloudShadowStandIn(device),
  }
  bounce.encoded = probes.encode(encoder, active, viewpoint, atlas, shade, drawnSurface(rt, cam))
  bounce.probesUpdated = probes.lastProbes
  bounce.raysLaunched = probes.lastRays
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
