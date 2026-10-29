import { GLOBAL_DISTANCE_FIELD_RULES } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import {
  resolveSetting,
  resolveSettingsInto,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  occlusionDistances,
  sizeForTraces,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { SkyLightPart } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import { createReflectionSettingsReader } from '../reflections/settings.ts'
import { createSkyOcclusionState, releaseSkyOcclusion, type SkyOcclusionState } from './ao/state.ts'
import {
  createDistanceFieldScene,
  DEFAULT_OCCLUSION_DISTANCE,
  type DistanceFieldScene,
} from './scene.ts'
import { createRuntimeFields, type RuntimeFields } from './runtime/runtimeFields.ts'
import { createVoxelKernel } from './runtime/voxelKernel.ts'
import { fieldTasks } from '../../geometry/work/host.ts'

/**
 * THE DISTANCE FIELDS IN THE FRAME. A session whose cache carries the meshes' distance fields
 * (`EngineContext.distanceFields`) makes the scene of them at its first image, and each image of
 * the main view brings it level with the cut's roots — read as they are, never changed — and
 * encodes its passes (`scene.ts`); once the image's encoder is submitted the readbacks it started
 * map (`distanceFieldsSubmitted`). A session whose cache carries none pays nothing, and a view
 * drawn aside updates nothing: the field follows the main camera. The camera's position is taken
 * to the field's unit, the centimetre. The global field is given the occlusion distance the fog's sky visibility and the
 * sky light's occlusion trace to: the sky light's where it is not static, else the scene's default.
 * The sky light's occlusion (`ao/runtime.ts`) keeps its state here too. With `runtimeMeshDistanceFields`, the meshes the world cut at
 * run time get a field built for them (`runtime/runtimeFields.ts`), and a session whose cache carries none is given the scene for them.
 */

/** What the frame keeps of the distance fields. */
export interface DistanceFieldFrameState {
  readonly scene: DistanceFieldScene
  readonly settings: GlobalDistanceFieldSettings
  /** The reflections' settings of the context, which say whether rays are marched through the field. */
  readonly reflections: ReturnType<typeof createReflectionSettingsReader>
  /** The clock of the last image, milliseconds. */
  time: number
  /** The sky light the frame held at this image's update, none where it has none. */
  skyLight: SkyLightPart | undefined
  /** The sky light's distance-field occlusion (`encodeSkyOcclusion`). */
  readonly occlusion: SkyOcclusionState
  /** The fields built for the meshes cut at run time, made the first time the setting asks for one. */
  runtime?: RuntimeFields
}

const origin: [number, number, number] = [0, 0, 0]

/** The longest step, seconds, one image's field update counts for: frames held on a compile or a grant draw nothing, so the wait before the next drawn image is not the scene's time
 *  (the reference counts the world's own delta, which a paused render does not stop: its state would depend on how long a compile took; a view's state here does not). */
const LONGEST_STEP = 0.1

/** Seconds from `before` to `now` (ms), at most `LONGEST_STEP`. */
export const imageStep = (now: number, before: number) =>
  Math.min(LONGEST_STEP, Math.max(0, (now - before) / 1000))

/** Whether `runtimeMeshDistanceFields` is on and the cut holds a mesh cut at run time whose triangles are known (`Primitive.rayTracing`). */
function asksRuntimeFields(rt: Pick<WebgpuPagesRuntime, 'context' | 'layout'>) {
  const rule = GLOBAL_DISTANCE_FIELD_RULES.runtimeMeshDistanceFields
  if (!resolveSetting(rule, rt.context.runtimeMeshDistanceFields)) return false
  // Read until the state exists, then no more: only while the setting is on and nothing runtime is in the cut yet.
  return rt.layout.selectionRoots.some((root) => root.runtime && root.rayTracing)
}

/** Whether the scene has distance fields: its cache carries the meshes' (`EngineContext.distanceFields`), or it holds a mesh cut at run time
 *  that gets one (`runtimeMeshDistanceFields`). The one question every reader of the fields asks before the scene is made, and the scene
 *  answers after. */
export const hasDistanceFields = (
  rt: Pick<WebgpuPagesRuntime, 'context' | 'layout' | 'distanceFields'>,
) => !!rt.context.distanceFields?.length || !!rt.distanceFields || asksRuntimeFields(rt)

/** The state of `rt`, made at the first image of a session whose cache has distance fields, or that holds a mesh cut at run time that asks for one. */
function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.distanceFields) return rt.distanceFields
  if (!hasDistanceFields(rt)) return undefined
  const fields = rt.context.distanceFields
  const state: DistanceFieldFrameState = {
    scene: createDistanceFieldScene(device, fields ?? [], (root) =>
      state.settings.runtimeMeshDistanceFields
        ? (state.runtime ??= createRuntimeFields(
            (signal) => createVoxelKernel(device, signal),
            fieldTasks,
            (error) => rt.diag.diagnosticFailure('runtime-distance-field', error),
          )).fieldOf(root)
        : undefined,
    ),
    settings: {} as GlobalDistanceFieldSettings,
    reflections: createReflectionSettingsReader(),
    time: performance.now(),
    skyLight: undefined,
    occlusion: createSkyOcclusionState(),
  }
  return (rt.distanceFields = state)
}

/** Encodes the distance fields' update for this image on `encoder`; `part` is the sky light the frame holds, if any. */
export function encodeDistanceFields(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  part: SkyLightPart | undefined,
) {
  if (rt.views.active !== rt.views.main) return
  const state = stateOf(rt, device)
  if (!state) return
  const now = performance.now()
  const delta = imageStep(now, state.time)
  state.time = now
  resolveSettingsInto(GLOBAL_DISTANCE_FIELD_RULES, rt.context, state.settings)
  // Rays marched through the field (the reflections' scene stage, and the passes that read the surface cache: the
  // cache's own lighting, the probes' traces) ask it the sizes of a march, and its pages flagged; a pass that reads
  // the surface cache asks for the object grid beside it (`demandSurfaceCache`, set by the last image, reset by the
  // cache's own encode that follows this one).
  const demanded = !!rt.surfaceCache?.demanded
  const traced = state.reflections(rt.context).marchesField || demanded
  if (traced) sizeForTraces(state.settings)
  state.skyLight = part
  state.scene.occlusionDistance = occlusionDistances(
    state.settings,
    part && part.light.mobility !== 'static'
      ? part.light.occlusionMaxDistance
      : DEFAULT_OCCLUSION_DISTANCE,
  ).global
  for (let k = 0; k < 3; k++) origin[k] = cam.eye[k] * DISTANCE_FIELD_UNITS_PER_METRE
  state.scene.update(
    encoder,
    {
      roots: rt.layout.selectionRoots,
      world: rt.run.gpuSelection?.world,
      moving: (rank) => rt.lights.mobility.moves(rank),
      // A placement cut at run time is read again when a field was built for one, or the setting changed.
      epoch: (state.runtime?.version ?? 0) * 2 + Number(state.settings.runtimeMeshDistanceFields),
      origin,
      frame: rt.run.frame,
      delta,
      traced,
      grid: demanded,
    },
    state.settings,
  )
}

/** After the image's encoder was submitted: the readbacks the update started map. */
export function distanceFieldsSubmitted(rt: Pick<WebgpuPagesRuntime, 'distanceFields'>) {
  rt.distanceFields?.scene.submitted()
}

/** Frees the distance fields of `rt`. */
export function disposeDistanceFields(rt: Pick<WebgpuPagesRuntime, 'distanceFields'>) {
  if (rt.distanceFields) releaseSkyOcclusion(rt.distanceFields.occlusion)
  rt.distanceFields?.runtime?.dispose()
  rt.distanceFields?.scene.dispose()
  rt.distanceFields = undefined
}
