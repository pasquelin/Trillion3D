import type { ResolvedSky } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import type { SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import type { CloudShadowSource } from './encodeCloudShadow.ts'
import type { SkyLightSource } from './skyLightState.ts'

/** What the world's owners hold that the module does not: where the sky light stands, its cube, the
 *  clouds' material and the time. */
export interface SkyModuleExtras {
  /** Where the sky light stands, scene metres. */
  readonly position: readonly [number, number, number]
  /** The cube of a light whose source is a specified cubemap, and the cube it blends to
   *  (`followSkyCubemaps`). */
  readonly cubemap?: GPUTexture
  readonly cubemapScale?: number
  readonly blend?: SkyLightSource['blend']
  /** What the capture traces the clouds with (`SkyLightInputs.clouds`), built over the clouds part. */
  readonly captureClouds?: SkyLightSource['clouds']
  /** What draws the scene aside for a captured scene: the engine. */
  readonly scene?: SceneCaptureHost
  /** The cloud material's seven bindings of the traces' group, once its textures are generated. */
  readonly material?: readonly GPUBindGroupEntry[]
  /** The time in seconds the clouds drift by. */
  readonly time: () => number
}

/** The clouds' shadow maps' source: the clouds part, once its material is there, and the sky light
 *  where it affects the world (the sky occlusion map is its). The maps are those of the air's two
 *  lights that cast cloud shadows, the light of each index taking its own (`encodeCloudShadow`), as
 *  the reference makes one for each atmosphere light, each with its history. */
export function cloudShadowSourceOf(
  sky: ResolvedSky | undefined,
  extras: Pick<SkyModuleExtras, 'material' | 'time'>,
): CloudShadowSource | undefined {
  const part = sky?.clouds
  if (!part || !extras.material) return undefined
  const skyLight = sky?.skyLight?.light
  return {
    part,
    material: extras.material,
    time: extras.time,
    skyLight: skyLight?.affectsWorld ? skyLight : undefined,
  }
}

/** The sky light's source: the sky light part where it affects the world, its clouds only where the clouds part is on. */
export function skyLightSourceOf(
  sky: ResolvedSky | undefined,
  extras: Pick<
    SkyModuleExtras,
    'position' | 'cubemap' | 'cubemapScale' | 'blend' | 'captureClouds' | 'scene'
  >,
): SkyLightSource | undefined {
  const part = sky?.skyLight
  // A light that does not affect the world is no part of the scene: it makes no proxy, so no capture.
  if (!part?.light.affectsWorld) return undefined
  return {
    part,
    position: extras.position,
    cubemap: extras.cubemap,
    cubemapScale: extras.cubemapScale,
    blend: extras.blend,
    clouds: sky?.clouds ? extras.captureClouds : undefined,
    scene: extras.scene,
  }
}
