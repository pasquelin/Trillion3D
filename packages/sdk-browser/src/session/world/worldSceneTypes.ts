import type { AnimationOptions } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import type { CutOptions } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { DynamicResolutionOptions } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { FamilyValues } from '../../../../sdk-core/src/runtime/settingFamilies.ts'

/** The world's scene settings by rule (`SETTING_FAMILIES`): the streaming of a partitioned scene's cells and the HLOD warm-up, the cut and the animation; each read as its fields resolved over the
 *  page and the quality preset, and written as the page's settings the options name. */
export interface WorldSceneSettings {
  /** How the view streams a partitioned scene's cells (`worldStreaming…`) and the warm-up an
   *  HLOD switch waits on (`hlodWarmup…`), each setting by its field
   *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings
   *  named apply from the next frame over the preset — one `null` gives it back to it, one left
   *  out stays —; one a setting does not take is refused. */
  get worldStreaming(): FamilyValues<'worldStreaming'>
  set worldStreaming(options: WorldStreamingOptions & HlodWarmupOptions)
  /** The cut's occlusion in two passes, its culls and how an upscaled image's level of detail
   *  follows the display, each setting by its field (`WorldOptions`), resolved over the page and
   *  the quality preset. Written, the settings named apply from the next frame over the preset —
   *  one `null` gives it back to it, one left out stays —; one a setting does not take is
   *  refused. */
  get cut(): FamilyValues<'cut'>
  set cut(options: CutOptions)
  /** The dynamic resolution's settings, each by its field (`WorldOptions`), resolved over the
   *  page and the quality preset: the GPU time budget the render scale (where it is `'auto'`)
   *  and the cut's edge scale are fitted to (`dynamicResolutionFrameTimeBudgetMs`, the frame
   *  cap's interval by default), the headrooms, the history kept and its weights, the change
   *  period and threshold, how far a rise goes, the frames over budget that end a history, the
   *  most the scale may be while throttled, and whether the CPU time of a frame excuses it.
   *  Written, the settings named apply from the next GPU time over the preset — one `null`
   *  gives it back to it, one left out stays —; one a setting does not take is refused. */
  get dynamicResolution(): FamilyValues<'dynamicResolution'>
  set dynamicResolution(options: DynamicResolutionOptions)
  /** The screen size under which an instanced skinned object is drawn in its rest pose and how
   *  the scene's animation banks play their tracks, each setting by its field (`WorldOptions`),
   *  resolved over the page and the quality preset. Written, the settings named apply from the
   *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
   *  setting does not take is refused. */
  get animation(): FamilyValues<'animation'>
  set animation(options: AnimationOptions)
}
