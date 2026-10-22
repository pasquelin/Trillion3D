import type { ShadowOptions } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ReflectionOptions } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { VolumetricFogOptions } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { TessellationOptions } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import type { MotionBlurSettings } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { DepthOfFieldSettings } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import type { BloomSettings } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import type { GaussianBlurSettings } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import type { FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import type { AmbientOcclusionOptions } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import type { SkyQualityOptions } from '../../../../sdk-core/src/modules/sky/quality.ts'
import type { worldFamilies } from './ruledSwitches.ts'

type Families = ReturnType<typeof worldFamilies>

/** The families by rule of the light: the sun's shadows, the screen probes, the reflections' trace,
 *  the volumetric fog, the sky's quality and the tessellation — read as `ruledAccessors` does. */
export function lightAccessors(families: Families) {
  return {
    /** The sun's shadow settings (`shadowOptions.ts`), resolved over the page and the preset. */
    get shadows() {
      return families.shadows.values()
    },
    set shadows(options: ShadowOptions) {
      families.shadows.set(options)
    },
    /** The screen probes' settings (`screenProbeOptions.ts`), resolved over the page and the preset. */
    get indirectLight() {
      return families.indirectLight.values()
    },
    set indirectLight(options: ScreenProbeOptions) {
      families.indirectLight.set(options)
    },
    /** The reflections' trace settings (`reflectionOptions.ts`), resolved over the page and the preset. */
    get reflections() {
      return families.reflections.values()
    },
    set reflections(options: ReflectionOptions) {
      families.reflections.set(options)
    },
    /** The volumetric fog's settings (`volumetricFogOptions.ts`), resolved over the page and the
     *  preset. */
    get volumetricFog() {
      return families.volumetricFog.values()
    },
    set volumetricFog(options: VolumetricFogOptions) {
      families.volumetricFog.set(options)
    },
    /** The sky's quality settings (`sky/quality.ts`): the atmosphere's, the clouds', the light
     *  shafts' and the sky light's, resolved over the page and the preset. */
    get skyQuality() {
      return families.skyQuality.values()
    },
    set skyQuality(options: SkyQualityOptions) {
      families.skyQuality.set(options)
    },
    /** The tessellation's settings (`tessellationOptions.ts`), resolved over the page and the preset. */
    get tessellation() {
      return families.tessellation.values()
    },
    set tessellation(options: TessellationOptions) {
      families.tessellation.set(options)
    },
  }
}

/** The families by rule of the image effects (motion blur, depth of field, bloom, film) and the
 *  screen-space ambient occlusion — read as `ruledAccessors` does. */
export function imageAccessors(families: Families) {
  return {
    /** How the motion blur is drawn (`motionBlurOptions.ts`), over the page and the preset. */
    get motionBlur() {
      return families.motionBlur.values()
    },
    set motionBlur(options: MotionBlurSettings) {
      families.motionBlur.set(options)
    },
    /** How the depth of field is drawn (`depthOfFieldRules.ts`), over the page and the preset. */
    get depthOfField() {
      return families.depthOfField.values()
    },
    set depthOfField(options: DepthOfFieldSettings) {
      families.depthOfField.set(options)
    },
    /** How the bloom is drawn (`bloomRules.ts`), over the page and the preset. */
    get bloom() {
      return families.bloom.values()
    },
    set bloom(options: BloomSettings) {
      families.bloom.set(options)
    },
    /** How the Gaussian blur is drawn (`gaussianBlurRules.ts`), over the page and the preset. */
    get gaussianBlur() {
      return families.gaussianBlur.values()
    },
    set gaussianBlur(options: GaussianBlurSettings) {
      families.gaussianBlur.set(options)
    },
    /** The film effects' settings (`filmOptions.ts`), resolved over the page and the preset. */
    get film() {
      return families.film.values()
    },
    set film(options: FilmSettings) {
      families.film.set(options)
    },
    /** The screen-space ambient occlusion's settings (`ambientOcclusionOptions.ts`), over the page and the
     *  preset. */
    get ambientOcclusion() {
      return families.ambientOcclusion.values()
    },
    set ambientOcclusion(options: AmbientOcclusionOptions) {
      families.ambientOcclusion.set(options)
    },
  }
}
