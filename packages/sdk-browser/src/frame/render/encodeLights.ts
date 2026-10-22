import type { EngineCamera } from '../../camera/engineCamera.ts'
import {
  environmentCurve,
  environmentSharpness,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { FILM_RULES, tonemapperSharpness } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { appliedExposureOf } from '../../post/exposure/applied.ts'
import { uploadSceneLights } from '../backend/state/lightBuffer.ts'
import { ensureBounce, syncLightingProxies } from '../prepare/bounce.ts'
import { probesWaitForSky } from './encodeAtmosphere.ts'
import { createMarkSurface } from '../../lighting/bounce/marks.ts'
import { planVsmFrame } from '../../lighting/shadows/vsm/frame/vsmPlan.ts'
import { encodeVsmFrame } from '../../lighting/shadows/vsm/frame/vsmEncode.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The floats the deferred and blend passes reread: lights, tiles in X and Y, exposure, display
 *  curve, the eye the fog is measured from, then the composition's sharpening strength. */
const directParams = new Float32Array(9)
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
 * bounce, the per-tile light lists, the virtual shadow maps' GPU work (`../../lighting/shadows/vsm/frame/vsmEncode.ts`), then
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
  const environment = store.environment
  directParams.fill(0)
  // Exposure is not a light: it sets conversion of radiance into an image, and cannot light anything
  // the declared lights do not already light. The word is the one the CPU knows
  // (`appliedExposureOf`); an automatic exposure replaces it, on the GPU, with the one measured on
  // this very image (`../../post/exposure/meter.ts`) before the composition reads it.
  directParams[3] = appliedExposureOf(rt)
  directParams[4] = environmentCurve(environment)
  // The eye itself, under any projection: an orthographic camera's view point is a direction.
  directParams.set(cam.eye, 5)
  directParams[8] = tonemapperSharpness(
    readSetting(FILM_RULES, rt.context, 'tonemapperSharpen'),
    environmentSharpness(environment),
  )
  // The unlit view reads neither light lists nor a shadow map: it therefore encodes none of them.
  // A representation change held for the camera to rest is released to the list now: the first
  // lit frame's invalidation stales its pages, whatever the camera does.
  if (!active || store.unlit) {
    lights.changes.releaseDeferred()
    // A lit view with no lamp may still hold an environment: its irradiance goes to the GPU.
    if (!store.unlit) uploadSceneLights(device, lights)
    return directParams
  }
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
  const listed = encodeTileLists(rt, encoder, viewProjection, cam.eye)
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
  encoder: GPUCommandEncoder,
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
) {
  const { lights, gpu } = rt,
    { tiles } = lights,
    [width, height] = gpu.targetSize
  // Sized before the bounce listed its world grid (`encodeDirectLights`); a buffer the world's growth
  // replaced since is bound again by the pass.
  if (!tiles || !lights.buffer) return false
  tiles.update(viewProjection, eye, width, height)
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
  if (probesWaitForSky(rt)) return
  // The store revision rises as soon as a light is added, set or removed: that is the signal the
  // grid needs to restart, and it costs no read. A change of fog alone is not one. The sky is the
  // other: a ray that leaves the scene reads the table the atmosphere builds when its sun or its air
  // changes (`skyBuilds`), which no light's revision tells.
  const skyBuilds = rt.gpu.atmosphere?.skyBuilds ?? 0
  if (bounce.lightEpoch !== lights.store.transportEpoch || bounce.skyBuilds !== skyBuilds) {
    bounce.lightEpoch = lights.store.transportEpoch
    bounce.skyBuilds = skyBuilds
    probes.restart()
  }
  // Camera world position, posted by image entry: the levels re-centre on it by cell step. No
  // allocation. What the image draws tells which cells it reads (`drawnSurface`): a pivoting camera
  // marks the cells it turns to.
  viewpoint.set(cam.eye)
  bounce.encoded = probes.encode(encoder, active, viewpoint, drawnSurface(rt, cam))
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
