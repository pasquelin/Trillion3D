import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import type { SkyLightPart } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { VolumetricLightmapData } from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'

/**
 * WHAT THE VOLUME TAKES OF THE BAKED LIGHT this image (the frame's `staticLight`, the static term's pass,
 * `staticWgsl.ts`):
 * - `intensity`: the fog's share of the lightmap's light (`staticLightingScatteringIntensity`), 0 unless
 *   the image's lighting is on — the only switch of the indirect light a view has — and the lightmap is
 *   read: present, and its setting (`volumetricLightmap`) on;
 * - `skyDiffuse`: whether the sky light lights the volume by its own harmonics: there is a sky light, it
 *   is not static (a static one is baked into the lightmap), and the view's sky lighting is on;
 * - `skyShadowing`: whether the sky light's term is multiplied by the visibility the lightmap stores
 *   (the bent normal's length) in place of the sky's visibility the global distance field gives: the
 *   light lights the volume, is stationary and casts shadows — and the lightmap holds a bent normal, which
 *   a bake without a sky light does not — and the image made no translucency volume, whose light takes the
 *   sky light's whole place in the cells (`translucencyGiWgsl.ts`).
 */
export interface FogStaticLight {
  intensity: number
  skyDiffuse: boolean
  skyShadowing: boolean
}

/** What the image takes of the baked light where there is none. */
export const newFogStaticLight = (): FogStaticLight => ({
  intensity: 0,
  skyDiffuse: false,
  skyShadowing: false,
})

/** Whether the baked light has a term to add this image, so that the static term's pass runs (when the
 *  image reads a lightmap). */
export const staticTermWanted = (light: FogStaticLight) => light.intensity > 0 || light.skyShadowing

/** What the rules read. */
export interface FogStaticLightSources {
  readonly medium: Pick<ResolvedVolumetricFog, 'staticLightingScatteringIntensity'>
  /** The image's lighting is on. */
  readonly lit: boolean
  /** The view's sky lighting is on. */
  readonly skyLighting: boolean
  /** The lightmap the view reads: none where the scene has none or the setting is off. */
  readonly lightmap: VolumetricLightmapData | undefined
  /** The sky light the frame holds, if any. */
  readonly sky: SkyLightPart | undefined
  /** The image made a translucency volume, which the cells take in the place of the sky light's term. */
  readonly translucencyGi: boolean
}

/** `into` set to what the image takes of the baked light (`FogStaticLight`). Nothing is allocated. */
export function setFogStaticLight(into: FogStaticLight, from: FogStaticLightSources) {
  const { medium, lit, skyLighting, lightmap, sky, translucencyGi } = from
  into.intensity = lit && lightmap ? medium.staticLightingScatteringIntensity : 0
  into.skyDiffuse = !!sky && sky.light.mobility !== 'static' && skyLighting
  into.skyShadowing =
    into.skyDiffuse &&
    !translucencyGi &&
    sky!.light.mobility === 'stationary' &&
    sky!.light.castShadows &&
    lightmap?.skyBentNormal !== undefined
  return into
}
