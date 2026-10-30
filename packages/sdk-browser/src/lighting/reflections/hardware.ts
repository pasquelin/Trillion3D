import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { isPending, isReady, REFLECTION_HIT_GROUP } from '../rays/sceneTrace/sceneMaskHold.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import { waterFrontOf } from '../../blend/water/waterReflection.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { sceneRaysOf } from '../surfaceCache/lighting/surfaceLighting.ts'
import type { ReflectionSettings } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { ScreenReflection } from './gpu.ts'
import { hardwareKernelKey, hardwareReflectionMaker } from './reflectionPipelines.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'

/**
 * THE SCENE STAGE'S RAYS THROUGH THE SCENE'S TRIANGLES (`sceneTraceHardware.ts`), whether this image casts them: the view is the main one — the
 * scene trace the lighting makes is written for its eye, `SceneRays` — and traces its reflections of a lit image, the settings say so
 * (`reflectionHardwareRayTracing`, the scene traced). A session that counts (`reflectionStatistics`) takes this path as well, so what it measures is the
 * shipped one: the stage binds no counters (its storage buffers are the eight a stage may hold), the census leaving how its rays ended and the steps they took
 * unknown (`countedBy`, `censusCount.ts`).
 */
function wants(rt: WebgpuPagesRuntime, settings: ReflectionSettings) {
  return settings.hardwareTraces && settings.marchesField && rt.views.active === rt.views.main
}

/** Whether this image's reflections want the scene trace made for their rays (`LightingInputs.probes`): the lighting then keeps it for the image
 *  (`sceneRaysOf`) whatever else is traced, once the scene has acceleration structures. */
export function reflectionsTraced(rt: WebgpuPagesRuntime) {
  const reflection = rt.gpu.reflection
  return (
    !!reflection &&
    wantsContractLighting(rt) &&
    drawsLit(rt.run.diagnostic) &&
    wants(rt, reflection.settings(rt.context, waterFrontOf(rt)))
  )
}

/** The scene trace the lighting made for this image's reflections where they cast their rays through the scene's triangles: none where the settings or the view say otherwise, or the scene has no acceleration structures. */
export function reflectionSceneRays(rt: WebgpuPagesRuntime, settings: ReflectionSettings) {
  return wants(rt, settings) ? sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame) : undefined
}

/** The scene trace of this image and the compiled scene stage that casts the reflections' rays through it, none where the image's rays are
 *  marched through the field instead: the settings or the view say so, the lighting made no scene trace for them (the scene has no acceleration
 *  structures, its buffers do not fit), or the program is still compiling. */
export function hardwareReflections(
  rt: WebgpuPagesRuntime,
  reflection: ScreenReflection,
  settings: ReflectionSettings,
  light: LightAtlasFormat,
  lit: boolean,
) {
  const rays = reflectionSceneRays(rt, settings)
  if (!rays) return undefined
  const key = hardwareKernelKey(light, lit)
  const stage = rays.sceneTrace.maskHold.use(
    'hardware reflections',
    key,
    hardwareReflectionMaker(reflection.device, key),
    isReady,
    isPending,
    REFLECTION_HIT_GROUP,
  )?.kernel
  return stage?.ready ? { rays, stage } : undefined
}
