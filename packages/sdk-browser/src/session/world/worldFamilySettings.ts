import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { AnimationOptions } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ExposureOptions } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { TemporalOptions } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { HizOptions } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import type { WorldParts } from './worldParts.ts'

/** The world's scene settings by rule (`ruledSwitches.ts`): the streaming of a partitioned scene's
 *  cells and the HLOD warm-up, the cut and the animation; each read as its fields resolved over the
 *  page and the quality preset, and written as the page's settings the options name. */
export function worldSceneSettings({ switches, live }: WorldParts) {
  return {
    /** How the view streams a partitioned scene's cells (`worldStreaming…`) and the warm-up an
     *  HLOD switch waits on (`hlodWarmup…`), each setting by its field
     *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings
     *  named apply from the next frame over the preset — one `null` gives it back to it, one left
     *  out stays —; one a setting does not take is refused. */
    get worldStreaming() {
      return switches.worldStreaming
    },
    set worldStreaming(options: WorldStreamingOptions & HlodWarmupOptions) {
      live()
      switches.worldStreaming = options
    },
    /** The cut's occlusion in two passes, its culls and how an upscaled image's level of detail
     *  follows the display, each setting by its field (`WorldOptions`), resolved over the page and
     *  the quality preset. Written, the settings named apply from the next frame over the preset —
     *  one `null` gives it back to it, one left out stays —; one a setting does not take is
     *  refused. */
    get cut() {
      return switches.cut
    },
    set cut(options: CutOptions) {
      live()
      switches.cut = options
    },
    /** The screen size under which an instanced skinned object is drawn in its rest pose and how
     *  the scene's animation banks play their tracks, each setting by its field (`WorldOptions`),
     *  resolved over the page and the quality preset. Written, the settings named apply from the
     *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
     *  setting does not take is refused. */
    get animation() {
      return switches.animation
    },
    set animation(options: AnimationOptions) {
      live()
      switches.animation = options
    },
  }
}

/** The world's image settings by rule (`ruledSwitches.ts`): the shading bins, the exposure and the
 *  temporal pass, read and written as the scene settings are (`worldSceneSettings`). */
export function worldImageSettings({ switches, live }: WorldParts) {
  return {
    /** How the shading bins hold each material class's pixels, each setting by its field
     *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings named
     *  apply from the next frame over the preset — one `null` gives it back to it, one left out
     *  stays —; one a setting does not take is refused. */
    get shading() {
      return switches.shading
    },
    set shading(options: ShadingOptions) {
      live()
      switches.shading = options
    },
    /** The automatic exposure's settings, used where `world.exposure` is `'auto'`, each by its
     *  field (`WorldOptions`), resolved over the page and the quality preset: the bias, the
     *  range the mean is held to in EV100, the histogram's span, the shares of the pixels left
     *  out, the speeds in stops a second, the transition distance, the weight of the black
     *  bucket and how a pixel's luminance is read. Written, the settings named apply from the
     *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
     *  setting does not take is refused. */
    get exposureSettings() {
      return switches.exposureSettings
    },
    set exposureSettings(options: ExposureOptions) {
      live()
      switches.exposureSettings = options
    },
    /** The temporal anti-aliasing's settings beside its level, each by its field (`WorldOptions`),
     *  resolved over the page and the quality preset: `temporalThinGeometry`, whether the pass
     *  looks for geometry thinner than a pixel and relaxes its history there. Written, the
     *  settings named apply from the next frame over the preset — one `null` gives it back to it,
     *  one left out stays —; one a setting does not take is refused. */
    get temporal() {
      return switches.temporal
    },
    set temporal(options: TemporalOptions) {
      live()
      switches.temporal = options
    },
    /** The depth pyramid's settings, each by its field (`WorldOptions`), resolved over the page
     *  and the quality preset: `hizTrace`, how the reflections' trace reads the pyramid;
     *  `hizFoldTransparents`, whether its trace layers hold the transparent surfaces;
     *  `hizTransparentTest`, how the transparent clusters are tested against it. Written, the
     *  settings named apply from the next frame over the preset — one `null` gives it back to
     *  it, one left out stays —; one a setting does not take is refused. */
    get hiz() {
      return switches.hiz
    },
    set hiz(options: HizOptions) {
      live()
      switches.hiz = options
    },
  }
}
