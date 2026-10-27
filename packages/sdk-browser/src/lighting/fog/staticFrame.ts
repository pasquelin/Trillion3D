import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { heldSkyLight } from '../../frame/render/skyLightHeld.ts'
import { volumetricLightmapOf } from '../volumetricLightmap/frame.ts'
import type { FogVolumeInputs } from './gpu.ts'
import { setFogStaticLight } from './staticLight.ts'

/**
 * What the volume takes of the baked light this image, written into `inputs` (`setFogStaticLight`): the
 * lightmap the `volumetricLightmap` setting lets the image read (made at the first image that asks,
 * `volumetricLightmapOf`; none for a scene without one), and the rules of its intensity and of the sky
 * light, read off the view's switches — `lighting` for the image's lighting, `skyLighting` for the sky
 * light's — and the sky light the frame holds.
 */
export function fillFogStaticLight(
  inputs: Pick<FogVolumeInputs, 'staticLight' | 'lightmap' | 'translucencyGi'>,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  medium: ResolvedVolumetricFog,
) {
  const { overrides } = rt.views.active
  inputs.lightmap = volumetricLightmapOf(rt, device)
  setFogStaticLight(inputs.staticLight, {
    medium,
    lit: overrides.lighting,
    skyLighting: overrides.skyLighting,
    lightmap: inputs.lightmap?.data,
    sky: heldSkyLight(rt),
    translucencyGi: !!inputs.translucencyGi,
  })
}
