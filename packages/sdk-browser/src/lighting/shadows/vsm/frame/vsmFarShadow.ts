import {
  resolveSettingsStamped,
  settingsWatch,
} from '../../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  readCutSetting,
  viewDistanceFactor,
} from '../../../../../../sdk-core/src/contracts/cutOptions.ts'
import {
  SHADOW_RULES,
  type ShadowValues,
} from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import {
  sunCascades,
  type SunCascades,
} from '../../../../../../sdk-core/src/contracts/sunCascades.ts'
import { shadowOfLight } from '../../../../../../sdk-core/src/scene/light/lightShadow.ts'
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { breakHeldFrame } from '../../../../frame/backend/state/view.ts'
import { noDofBias } from '../dofBias.ts'
import type { VsmMapSettings } from '../mapSettings.ts'

/**
 * The draw distances the casters take (`VsmRenderScene.drawDistance`): the view's factor, the
 * cut's own (`viewDistanceFactor`; the field of view's scale is the primitives' alone, the casters'
 * test reads none), when the camera's cut holds a placement that names a distance, those of the
 * instances while the host did not turn their cull off (`cutDrawDistanceCulling`), none otherwise.
 */
export const casterDrawDistance = (
  rt: WebgpuPagesRuntime,
  cut: { readonly drawDistances: boolean } | null | undefined,
) =>
  cut?.drawDistances
    ? { scale: viewDistanceFactor(rt), instances: readCutSetting(rt, 'cutDrawDistanceCulling') }
    : undefined

/** The watch of each session's shadow settings (`followShadowSettings`). */
const watches = new WeakMap<object, ReturnType<typeof settingsWatch<typeof SHADOW_RULES>>>()

/**
 * Follows the shadow settings at the frame's entry, before the frame is held: the settings are the
 * view's quality (a host sets them in the context, read live), so a change of any of them - the
 * gate that turns every shadow on or off, the pool, the traces - is a change of the view, and the
 * revision that names it moves where it is read (`viewReplaced`): a frame held on the settings
 * of the one before would never plan the set the new ones ask. The first reading moves it once. The maps' cache follows what its pages hold
 * on its own (`followCacheContent`).
 */
export function followShadowSettings(rt: WebgpuPagesRuntime) {
  let watch = watches.get(rt)
  if (!watch) watches.set(rt, (watch = settingsWatch(SHADOW_RULES)))
  watch.read(rt.context)
  if (watch.moved) breakHeldFrame(rt, rt.views.active)
}

/** The shadow settings the session holds, resolved into the one object each call rewrites. */
const shadows = {} as ShadowValues
const mapSettings = { shadows, frame: 0, dof: noDofBias(), firstPerson: { active: false } }

/** The shadow settings the session holds and the scene frame, as the maps' setup reads them
 *  (`VsmMapSettings`): the one object, rewritten by each call. */
export function vsmMapSettings(rt: WebgpuPagesRuntime): VsmMapSettings {
  resolveSettingsStamped(SHADOW_RULES, rt.context, shadows)
  mapSettings.frame = rt.run.frame
  return mapSettings
}

/** Whether the suns take a first-person clipmap this frame (`shadowFirstPersonClipmap`, an object in the
 *  scene standing for a first-person one): the plan's, once the placements' words are written. */
export const vsmFirstPersonActive = (rt: WebgpuPagesRuntime) =>
  shadows.shadowFirstPersonClipmap && rt.lights.mobility.worldSpace > 0

/** What a light that is no sun has of cascades: none. */
const NO_CASCADES: SunCascades = Object.freeze({ edge: 0 })

/** Whether the scene has distance fields: its cache carries the meshes' (`EngineContext.distanceFields`),
 *  the setting of the build that makes them — the project's, where a distance-field cascade is due. */
const sceneHasDistanceFields = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  !!rt.context.distanceFields?.length

/**
 * The cascades of the sun `light` seen from a view whose near plane is `near`, under the view's
 * settings `shadows` (`sunCascades`): the edge of its near cascade — 0, none, when the culling is
 * off, the light has no near level or it is not a sun — and the planes of its distance-field
 * cascade, where it has one. The shadow maps take every cluster caster, whatever its distance: the
 * far-shadow test reaches the subjects gathered on the CPU alone, none of which is a cluster.
 */
export const sunCascadesOf = (
  rt: Pick<WebgpuPagesRuntime, 'context'>,
  light: SceneLight,
  near: number,
  shadows: ShadowValues,
) =>
  light.kind === 'directional'
    ? sunCascades(shadowOfLight(light), near, shadows, sceneHasDistanceFields(rt))
    : NO_CASCADES
