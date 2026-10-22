import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  DISTANCE_FIELD_OCCLUSION_RULES,
  resolveDistanceFieldOcclusion,
  type DistanceFieldOcclusionSettings,
  type DistanceFieldOcclusionValues,
} from '../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { occlusionDistances } from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { SkyLightPart } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { encodeDistanceFieldOcclusion } from '../../lighting/distanceField/ao/frame.ts'
import type { DfaoImage } from '../../lighting/distanceField/ao/params.ts'
import { writeDfaoRead } from '../../lighting/distanceField/ao/readWgsl.ts'
import {
  releaseSkyOcclusion,
  type SkyOcclusionState,
} from '../../lighting/distanceField/ao/state.ts'
import type { DistanceFieldScene } from '../../lighting/distanceField/scene.ts'
import { NO_SKY_LIGHT_OCCLUSION } from '../../modules/sky/skyLight/read.ts'
import { screenProbesCast } from '../../lighting/bounce/screen/cast.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { wantsContractLighting } from '../prepare/contractLight.ts'

/** What the gates hand: the distance fields, the sky light and the occlusion's settings. */
interface SkyOcclusionGate {
  readonly scene: DistanceFieldScene
  readonly part: SkyLightPart
  readonly settings: DistanceFieldOcclusionSettings
}

const values = {} as DistanceFieldOcclusionValues

/**
 * WHETHER THE SKY LIGHT IS OCCLUDED BY THE DISTANCE FIELDS THIS IMAGE, the reference's gate: the view is the main one
 * (a capture's views are no reflection capture's and the field follows the main camera), its lighting and sky light
 * are on, no screen probes light the pixels, the sky light is dynamic (movable) and casts shadows, the occlusion is
 * allowed (`distanceFieldOcclusion` and a quality of 1 or more) and the scene has distance-field objects. With
 * `volumetric`, the fog's gate: the light casts a volumetric shadow as well, the global distance field is on, and
 * the view is a perspective one. None where it fails.
 */
function skyOcclusionGate(
  rt: WebgpuPagesRuntime,
  volumetric: boolean,
  perspective = true,
): SkyOcclusionGate | undefined {
  const scene = rt.distanceFields?.scene
  const part = scene && rt.distanceFields?.skyLight
  if (!scene || !part || rt.views.active !== rt.views.main) return undefined
  const { overrides } = rt.views.active
  if (!overrides.lighting || !overrides.skyLighting || screenProbesCast(rt)) return undefined
  const { light } = part
  if (light.mobility !== 'movable' || !light.castShadows || scene.meshes.count === 0)
    return undefined
  const settings = resolveDistanceFieldOcclusion(
    resolveSettingsInto(DISTANCE_FIELD_OCCLUSION_RULES, rt.context, values),
  )
  if (!settings.allowed) return undefined
  if (volumetric && (!light.castVolumetricShadow || !perspective)) return undefined
  if (volumetric && !rt.distanceFields!.settings.globalDistanceField) return undefined
  return { scene, part, settings }
}

/** The global distance field the fog's samples find the sky's visibility in, where the fog's gate holds
 *  (`skyOcclusionGate` with `volumetric`) for a view that is `perspective` or not; none, the sky is wholly visible. */
export const fogSkyField = (rt: WebgpuPagesRuntime, perspective: boolean) =>
  skyOcclusionGate(rt, true, perspective)?.scene

const image: DfaoImage = {
  view: [0, 0],
  extent: [0, 0],
  viewProjection: [],
  previousViewProjection: [],
  world: [],
  projection: [],
  near: 0,
  far: 0,
  perspective: true,
  frame: 0,
  temporalIndex: 0,
  velocity: false,
}

/** What the frame gives the occlusion that it draws from: the depth pyramid this image built, the surfaces' normals,
 *  the vectors of motion the velocity stage measured; none while the frame lacks the first two. */
function sourcesOf(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt
  const depth = vis.gpuHiz?.depth()
  const normals = gpu.surfaces?.views()[1]
  if (!gpu.device || !depth || !normals || !run.depthDrawn) return undefined
  if (!wantsContractLighting(rt) || !drawsLit(run.diagnostic)) return undefined
  const { velocity } = gpu
  const vectors = velocity?.active && velocity.measured ? velocity.vectors : undefined
  return { device: gpu.device, depth, normals, vectors }
}

/** The image described to the occlusion, from the camera and the frame's targets. */
function describe(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  state: SkyOcclusionState,
  velocity: boolean,
) {
  const { gpu } = rt
  image.view = gpu.targetSize
  image.extent = gpu.allocatedSize
  image.viewProjection = cam.viewProjection
  image.previousViewProjection = state.hasPrevious ? state.previous : cam.viewProjection
  image.world = cam.world
  image.projection = cam.projection
  image.near = cam.near
  image.far = cam.far
  image.perspective = cam.perspective > 0.5
  image.frame = rt.run.frame
  image.temporalIndex = rt.run.frame & 3
  image.velocity = velocity
  return image
}

/**
 * THE SKY LIGHT'S DISTANCE-FIELD OCCLUSION OF THE IMAGE, drawn where the reference's gate holds (`skyOcclusionGate`),
 * after the distance fields' update (`encodeDistanceFields`) and the depth pyramid the image built, before the lighting
 * that reads it. It leaves its texture, the read uniform and how the light applies it on the state
 * (`DistanceFieldFrameState.occlusion`); none, and the resources given back, where the gate fails.
 */
export function encodeSkyOcclusion(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const state = rt.distanceFields?.occlusion
  if (!state) return
  state.output = undefined
  state.use = NO_SKY_LIGHT_OCCLUSION
  const gate = skyOcclusionGate(rt, false)
  const sources = gate && sourcesOf(rt)
  if (!gate || !sources) return releaseSkyOcclusion(state)
  const { scene, part, settings } = gate
  const cut = rt.run.gate.temporalRevision !== state.revision
  state.revision = rt.run.gate.temporalRevision
  const drawn = describe(rt, cam, state, !!sources.vectors)
  state.output = encodeDistanceFieldOcclusion(state.dfao, sources.device, encoder, {
    depth: sources.depth,
    surfaceNormals: sources.normals,
    vectors: sources.vectors,
    field: scene,
    objects: scene.meshes.generation > 0 ? scene.meshes : undefined,
    settings,
    image: drawn,
    distances: occlusionDistances(rt.distanceFields!.settings, part.light.occlusionMaxDistance),
    historyCut: cut,
  })
  state.previous.set(cam.viewProjection)
  state.hasPrevious = true
  if (!state.output) return
  writeDfaoRead(state.dfaoRead, drawn.extent, drawn.view, settings)
  state.use = {
    applied: true,
    specularMode: settings.specularMode,
    specularStrength: settings.specularStrength,
  }
}
