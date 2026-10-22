import type { MeasuredWorld } from '../explorer.ts'
import {
  resolveSetting,
  type SettingOptions,
  type SettingRule,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { WorldSettings } from './settings.ts'
import { WORLD_STREAMING_RULES } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { STREAMING_RULES } from '../../../../sdk-core/src/contracts/streamingOptions.ts'
import { RASTER_RULES } from '../../../../sdk-core/src/contracts/rasterOptions.ts'
import { CUT_RULES } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import { ANIMATION_RULES } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import { SHADING_RULES } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { SCREEN_PROBE_RULES } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { REFLECTION_RULES } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { TESSELLATION_RULES } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import { MOTION_BLUR_RULES } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { AMBIENT_OCCLUSION_RULES } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { BLOOM_RULES } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import { FILM_RULES } from '../../../../sdk-core/src/contracts/filmOptions.ts'

/** A family's rules, by field. */
type Rules = Readonly<Record<string, SettingRule>>
/** The values of the family of rules `R`, by field. */
type Values<R extends Rules> = { -readonly [F in keyof R]: R[F]['default'] }
/** A field of the family of rules `R`. */
type Field<R extends Rules> = keyof R & string

/**
 * A family of settings declared by rule (`settingRules.ts`) among the world's switches
 * (`switches.ts`): each field a render setting of the world's registry under its own name
 * (`settings.ts`), read by the one resolver of the rules (`resolveSetting`) wherever it is
 * written.
 * - `page` writes the settings the page opened the world with, at the page's priority;
 * - `get` is one of its settings resolved over the page and the preset;
 * - `values` is the family resolved over the page and the preset, by field: what a session opens
 *   with;
 * - `watch` writes each resolved value that changes into the open session (`write`, the family's
 *   setter of a session) and asks for a frame;
 * - `apply` writes into the session just opened each setting the page changed since it was given
 *   its options;
 * - `set` writes the page's settings `options` name: one `null` gives the setting back to the
 *   preset, one left out stays as it is.
 * The registry is typed over every family at once; a family names its own fields alone.
 */
function ruledSwitches<R extends Rules>(
  settings: WorldSettings,
  rules: R,
  write: (session: MeasuredWorld, field: Field<R>, value: never) => void,
) {
  const fields = Object.keys(rules) as Field<R>[]
  const registry = settings as unknown as {
    get(name: string): R[Field<R>]['default']
    set(name: string, value: R[Field<R>]['default'], source: 'page'): void
    clear(name: string, source: 'page'): void
    watch(name: string, hook: (value: R[Field<R>]['default']) => void): void
  }
  /** The page's `option` of `field`, as its one resolver reads it (a level also takes a switch). */
  const pageSet = (field: Field<R>, option: SettingOptions<R>[Field<R>]) =>
    registry.set(field, resolveSetting(rules[field], option as never), 'page')
  return {
    page(options: SettingOptions<R>) {
      for (const field of fields) if (options[field] != null) pageSet(field, options[field]!)
    },
    get: <F extends Field<R>>(field: F) => registry.get(field) as R[F]['default'],
    values: () =>
      Object.fromEntries(fields.map((field) => [field, registry.get(field)])) as Values<R>,
    watch(session: () => MeasuredWorld | null, invalidate: () => void) {
      for (const field of fields)
        registry.watch(field, (value) => {
          const opened = session()
          if (opened) write(opened, field, value as never)
          invalidate()
        })
    },
    apply(opened: MeasuredWorld, given: SettingOptions<R>) {
      for (const field of fields)
        if (registry.get(field) !== given[field]) write(opened, field, registry.get(field) as never)
    },
    set(options: SettingOptions<R>) {
      for (const field of fields) {
        if (!(field in options)) continue
        const option = options[field]
        if (option == null) registry.clear(field, 'page')
        else pageSet(field, option)
      }
    },
  }
}

/** The world's families by rule over its registry `settings`, each read by its rules' one
 *  resolver and written into a session by its own setter: the cluster raster's split, the geometry
 *  streaming, the partition's streaming and the HLOD warm-up, the cut, the animation, the
 *  shading, the automatic exposure, the temporal pass, the sun's shadows, the motion blur, the film
 *  effects, the reflections' trace, the screen-space ambient occlusion. */
export const worldFamilies = (settings: WorldSettings) => ({
  raster: ruledSwitches(settings, RASTER_RULES, (session, field, value) =>
    field === 'softwareRaster'
      ? session.setSoftwareRaster(value as boolean)
      : session.setHardwareRasterEdgePixels(value as number),
  ),
  streaming: ruledSwitches(settings, STREAMING_RULES, (session, field, value) =>
    session.setStreaming(field, value),
  ),
  worldStreaming: ruledSwitches(settings, WORLD_STREAMING_RULES, (session, field, value) =>
    session.setWorldStreaming(field, value),
  ),
  cut: ruledSwitches(settings, CUT_RULES, (session, field, value) => session.setCut(field, value)),
  dynamicResolution: ruledSwitches(settings, DYNAMIC_RESOLUTION_RULES, (session, field, value) =>
    session.setDynamicResolution(field, value),
  ),
  animation: ruledSwitches(settings, ANIMATION_RULES, (session, field, value) =>
    session.setAnimation(field, value),
  ),
  shading: ruledSwitches(settings, SHADING_RULES, (session, field, value) =>
    session.setShading(field, value),
  ),
  exposure: ruledSwitches(settings, EXPOSURE_RULES, (session, field, value) =>
    session.setExposure(field, value),
  ),
  temporal: ruledSwitches(settings, TEMPORAL_RULES, (session, field, value) =>
    session.setTemporal(field, value),
  ),
  shadows: ruledSwitches(settings, SHADOW_RULES, (session, field, value) =>
    session.setShadows(field, value),
  ),
  indirectLight: ruledSwitches(settings, SCREEN_PROBE_RULES, (session, field, value) =>
    session.setIndirectLight(field, value),
  ),
  reflections: ruledSwitches(settings, REFLECTION_RULES, (session, field, value) =>
    session.setReflections(field, value),
  ),
  volumetricFog: ruledSwitches(settings, VOLUMETRIC_FOG_RULES, (session, field, value) =>
    session.setVolumetricFog(field, value),
  ),
  tessellation: ruledSwitches(settings, TESSELLATION_RULES, (session, field, value) =>
    session.setTessellation(field, value),
  ),
  motionBlur: ruledSwitches(settings, MOTION_BLUR_RULES, (session, field, value) =>
    session.setMotionBlur(field, value),
  ),
  depthOfField: ruledSwitches(settings, DEPTH_OF_FIELD_RULES, (session, field, value) =>
    session.setDepthOfField(field, value),
  ),
  bloom: ruledSwitches(settings, BLOOM_RULES, (session, field, value) =>
    session.setBloom(field, value),
  ),
  gaussianBlur: ruledSwitches(settings, GAUSSIAN_BLUR_RULES, (session, field, value) =>
    session.setGaussianBlur(field, value),
  ),
  film: ruledSwitches(settings, FILM_RULES, (session, field, value) =>
    session.setFilm(field, value),
  ),
  ambientOcclusion: ruledSwitches(settings, AMBIENT_OCCLUSION_RULES, (session, field, value) =>
    session.setAmbientOcclusion(field, value),
  ),
})
