import { cloudsReadOpaqueShadow } from '../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import type { ResolvedSky } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import type { CloudTraceFrame } from '../../modules/sky/clouds/traceExtraLayout.ts'
import { setCloudShadowSource } from './encodeCloudShadow.ts'
import { setSkyLightSource } from './skyLightState.ts'
import { type SkyModuleExtras, cloudShadowSourceOf, skyLightSourceOf } from './skyModuleSources.ts'

/**
 * THE SKY MODULE AS THE FRAME'S PASSES ARE GATED ON IT. The module's parts (`ResolvedSky`) are the
 * one switch: the sky light's capture runs for the `skyLight` part, the clouds' shadow maps and
 * their trace in the view for the `clouds` part, the clouds in the capture for the `clouds` part.
 * With the module off (nothing resolved) every source is cleared: no capture, no map and no
 * trace is made, allocated or encoded, and what an earlier image made is released
 * (`setSkyLightSource`, `setCloudShadowSource`).
 */

/** The sky module's word given to the frame of `rt`: each source set from its part, or cleared. */
export function applySkyModule(
  rt: Parameters<typeof setSkyLightSource>[0],
  sky: ResolvedSky | undefined,
  extras: SkyModuleExtras,
) {
  setSkyLightSource(rt, skyLightSourceOf(sky, extras))
  setCloudShadowSource(rt, cloudShadowSourceOf(sky, extras))
}

/** What the main view's clouds' trace is told of its frame (neither a reflection nor the sky
 *  light's capture): the sun's opaque shadow is read by the march where the air's first light
 *  (`first`, the light held for index 0) asks for it (`cloudsReadOpaqueShadow`, which the reference
 *  keys on the first light's `GetCastShadowsOnClouds`) and has a shadow map to read (`shadowed`);
 *  none without that light. `airless`: the scene has no atmosphere. */
export const cloudTraceFrameOf = (
  first: SceneLight | undefined,
  shadowed: boolean,
  airless: boolean,
): CloudTraceFrame => ({
  reflection: false,
  skyCapture: false,
  sunShadowsOnClouds: !!first && shadowed && cloudsReadOpaqueShadow(cloudShadowOfLight(first), 0),
  airless,
})
