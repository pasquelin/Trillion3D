import type { EngineCamera } from '../../camera/engineCamera.ts'
import { encodeSunFieldShadows } from '../../lighting/distanceField/shadow/frame.ts'
import type { DfshImage, DfshSettings } from '../../lighting/distanceField/shadow/params.ts'
import {
  createSunShadowState,
  releaseSunShadow,
  type SunShadowState,
} from '../../lighting/distanceField/shadow/state.ts'
import { readSingleLayerWaterSetting } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import { foldedDepth } from '../../blend/water/waterFold.ts'
import { waterWanted } from '../../blend/water/waterTargets.ts'
import { readShadowSetting } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { vsmMapSettings } from '../../lighting/shadows/vsm/frame/vsmFarShadow.ts'
import { shadowsOn } from '../../lighting/shadows/vsm/frame/vsmGates.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { wantsContractLighting } from '../prepare/lit.ts'
import { lights, sunsOf } from './sunFieldLights.ts'

/** The camera of the image, rewritten by each image. */
const image: DfshImage = {
  view: [0, 0],
  extent: [0, 0],
  world: [],
  projection: [],
  viewProjection: [],
  eye: [],
  near: 0,
  far: 0,
  perspective: true,
}
const settings: DfshSettings = {
  quality: 3,
  fullResolution: false,
  tileSize: 2,
  twoSidedBias: 1,
  perTile: 128,
  farMeshes: false,
}

/** What the image draws the cascade with: the scene's distance fields, its depth and its surfaces'
 *  flags, the lit view's gate. None where the image is no lit view of the main camera, a diagnostic view, or no
 *  mesh has a field. */
function gate(rt: WebgpuPagesRuntime) {
  const scene = rt.distanceFields?.scene
  const { gpu, run, views } = rt
  const depth = rt.vis.gpuHiz?.depth(),
    flags = gpu.surfaces?.views()[3]
  if (!scene || views.active !== views.main || !views.active.overrides.lighting) return undefined
  if (!gpu.device || !depth || !flags || !run.depthDrawn || !shadowsOn(rt)) return undefined
  if (scene.meshes.generation === 0 || scene.meshes.count === 0) return undefined
  if (!wantsContractLighting(rt) || !drawsLit(run.diagnostic)) return undefined
  return { scene, depth, flags, device: gpu.device }
}

/** The view's settings of the cascade, into `settings` (`SUN_SHADOW_RULES`). */
function settingsOf(rt: WebgpuPagesRuntime) {
  const { shadows } = vsmMapSettings(rt)
  settings.quality = shadows.distanceFieldShadowQuality
  settings.fullResolution = shadows.distanceFieldShadowFullResolution
  settings.tileSize = shadows.distanceFieldShadowTileSize
  settings.twoSidedBias = shadows.distanceFieldShadowTwoSidedBias
  settings.perTile = shadows.distanceFieldShadowObjectsPerTile
  settings.farMeshes = shadows.farShadowCullsAllMeshes
}

/** The image described to the cascade, from the camera and the frame's targets. */
function describe(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  image.view = rt.gpu.targetSize
  image.extent = rt.gpu.allocatedSize
  image.world = cam.world
  image.projection = cam.projection
  image.viewProjection = cam.viewProjection
  image.eye = cam.eye
  image.near = cam.near
  image.far = cam.far
  image.perspective = cam.perspective > 0.5
}

/**
 * THE SUN'S DISTANCE-FIELD SHADOW OF THE IMAGE, drawn for the suns that have a cascade of the distance
 * fields (`sunCascades`, the shadow distance past which the maps do not reach): the meshes the
 * far-shadow test leaves out of the maps, traced against their fields (`encodeSunFieldShadows`). It
 * leaves the mask on the state (`DistanceFieldFrameState.sunShadow`), which the lighting multiplies a sun's
 * shadow by (`vsmSunFactor`); none, and the resources given back, where nothing is drawn. Costs
 * nothing while no mesh is one the test leaves out: the view's `farShadowCullsAllMeshes` off and no
 * object that says the test reaches it.
 */
export function encodeSunFieldShadow(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const state: SunShadowState | undefined = rt.distanceFields?.sunShadow
  if (state) traceSunFieldShadow(rt, encoder, cam, state)
}

/** The cascade traced into `state`'s mask over the depth `at` gives (the Hi-Z's own where none). */
function traceSunFieldShadow(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  state: SunShadowState,
  at?: (depth: HizDepth) => HizDepth,
) {
  state.mask = undefined
  const drawn = gate(rt)
  // Nothing to draw while no mesh is one the far-shadow test leaves out of the shadow maps.
  const wanted =
    !!drawn &&
    (readShadowSetting(rt, 'farShadowCullsAllMeshes') || drawn.scene.meshes.farShadowObjects > 0)
  if (wanted) {
    settingsOf(rt)
    sunsOf(rt)
  }
  if (!wanted || !lights.length) return releaseSunShadow(state)
  describe(rt, cam)
  state.mask = encodeSunFieldShadows(state.dfsh, drawn.device, encoder, {
    image,
    settings,
    lights,
    sources: {
      depth: at ? at(drawn.depth) : drawn.depth,
      flags: drawn.flags,
      objects: drawn.scene.meshes,
    },
  })
}

/**
 * THE SUN'S DISTANCE-FIELD SHADOW AT THE WATER'S DEPTH, for the sun the single-layer water keeps apart: the cascade
 * traced again, into a mask of its own (`WaterSun.state`), over the depth pyramid's level 0 with the front layer
 * folded in — the nearest transparent surface the front pass wrote, which is the water where it covers —
 * whatever `hizFoldTransparents` says of the opaque trace's. The levels uniform is copied with its front word up
 * (`foldedDepth`); the water's composite multiplies the separated sun by the mask. None, the mask given back, without a water
 * whose settings keep the sun apart by the distance-field shadow.
 */
export function encodeWaterSunFieldShadow(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const held = (rt.blendState.waterSun ??= { state: createSunShadowState() })
  if (
    !waterWanted(rt) ||
    !readSingleLayerWaterSetting(rt, 'singleLayerWaterShadersSupportDistanceFieldShadow') ||
    !readSingleLayerWaterSetting(rt, 'singleLayerWaterDistanceFieldShadow')
  )
    return releaseSunShadow(held.state)
  traceSunFieldShadow(rt, encoder, cam, held.state, (depth) =>
    foldedDepth(rt, encoder, held, depth),
  )
}
