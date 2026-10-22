import { cloudsReadOpaqueShadow } from '../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import type { ResolvedSky } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import type { CloudTraceFrame } from '../../modules/sky/clouds/traceExtraLayout.ts'
import type { SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import { setCloudShadowSource, type CloudShadowSource } from './encodeCloudShadow.ts'
import { setSkyLightSource, type SkyLightSource } from './skyLightState.ts'

/**
 * THE SKY MODULE AS THE FRAME'S PASSES ARE GATED ON IT. The module's parts (`ResolvedSky`) are the
 * one switch: the sky light's capture runs for the `skyLight` part, the clouds' shadow maps and
 * their trace in the view for the `clouds` part, the clouds in the capture for the `clouds` part.
 * With the module off (nothing resolved) every source is cleared: no capture, no map and no
 * trace is made, allocated or encoded, and what an earlier image made is released
 * (`setSkyLightSource`, `setCloudShadowSource`).
 */

/** What the world's owners hold that the module does not: where the sky light stands, its cube, the
 *  clouds' material and the time. */
export interface SkyModuleExtras {
  /** Where the sky light stands, scene metres. */
  readonly position: readonly [number, number, number]
  /** The host's cube, for a light whose source is a specified cubemap. */
  readonly cubemap?: GPUTexture
  /** What the capture traces the clouds with (`SkyLightInputs.clouds`), built over the clouds part. */
  readonly captureClouds?: SkyLightSource['clouds']
  /** What draws the scene aside for a captured scene: the engine. */
  readonly scene?: SceneCaptureHost
  /** The cloud material's seven bindings of the traces' group, once its textures are generated. */
  readonly material?: readonly GPUBindGroupEntry[]
  /** The time in seconds the clouds drift by. */
  readonly time: () => number
}

/** The clouds' shadow maps' source: the clouds part, once its material is there. The maps are those
 *  of the air's two lights that cast cloud shadows, the light of each index taking its own
 *  (`encodeCloudShadow`), as the reference makes one for each atmosphere light, each with its
 *  history. */
function cloudShadowSourceOf(
  sky: ResolvedSky | undefined,
  extras: Pick<SkyModuleExtras, 'material' | 'time'>,
): CloudShadowSource | undefined {
  const part = sky?.clouds
  if (!part || !extras.material) return undefined
  return { part, material: extras.material, time: extras.time }
}

/** The sky light's source: the sky light part where it affects the world, its clouds only where the clouds part is on. */
function skyLightSourceOf(
  sky: ResolvedSky | undefined,
  extras: Pick<SkyModuleExtras, 'position' | 'cubemap' | 'captureClouds' | 'scene'>,
): SkyLightSource | undefined {
  const part = sky?.skyLight
  // A light that does not affect the world is no part of the scene: it makes no proxy, so no capture.
  if (!part?.light.affectsWorld) return undefined
  return {
    part,
    position: extras.position,
    cubemap: extras.cubemap,
    clouds: sky?.clouds ? extras.captureClouds : undefined,
    scene: extras.scene,
  }
}

/** The sky module's word given to the frame of `rt`: each source set from its part, or cleared. */
export function applySkyModule(
  rt: Parameters<typeof setSkyLightSource>[0],
  sky: ResolvedSky | undefined,
  extras: SkyModuleExtras,
) {
  setSkyLightSource(rt, skyLightSourceOf(sky, extras))
  setCloudShadowSource(rt, cloudShadowSourceOf(sky, extras))
}

/** What the clouds' trace is told of its frame: the sun's opaque shadow is read by the march where
 *  the air's first light (`first`, the light held for index 0) asks for it (`cloudsReadOpaqueShadow`, which the reference keys on the
 *  first light's `GetCastShadowsOnClouds`) and has a shadow map to read (`shadowed`); none without
 *  that light. `airless`: the scene has no atmosphere. */
export const cloudTraceFrameOf = (
  first: SceneLight | undefined,
  shadowed: boolean,
  reflection: boolean,
  skyCapture: boolean,
  airless: boolean,
): CloudTraceFrame => ({
  reflection,
  skyCapture,
  sunShadowsOnClouds: !!first && shadowed && cloudsReadOpaqueShadow(cloudShadowOfLight(first), 0),
  airless,
})
