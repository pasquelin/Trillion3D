import type { MeasuredWorld } from '../explorer.ts'
import type { MeasuredWorldOptions } from '../options.ts'
import type { WorldOptions } from './options.ts'
import { createWorldEffects } from '../../../../sdk-core/src/world/effect/defaultChain.ts'
import { createGuideSet, type Guides } from '../../guides/guideSet.ts'
import type { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { createWorldSettings, type WorldSettings } from './settings.ts'
import { createWorldQuality, renderScaleOf } from './quality.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  temporalAntialiasingLevel,
  type TemporalAntialiasingOption,
} from '../../../../sdk-core/src/contracts/materialOptions.ts'
import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { AnimationOptions } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ExposureOptions } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { TemporalOptions } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { ShadowOptions } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ReflectionOptions } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { VolumetricFogOptions } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { TessellationOptions } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import type { MotionBlurSettings } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { DepthOfFieldSettings } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import type { BloomSettings } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import type { FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import type { AmbientOcclusionOptions } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import type { HizOptions } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import { worldFamilies } from './ruledSwitches.ts'

/** What of the world's runtime the switches reach: its open session and a frame. */
interface SwitchedRuntime {
  readonly explorer: MeasuredWorld | null
  invalidate(): void
}

/** What the world holds for the sessions it opens: the registry's resolved values, read where a
 *  session opens; the render scale and the frame cap as asked; the effect chain and the guides, one
 *  for the world's life; the particle pools attached. */
function heldSwitches(options: WorldOptions, settings: WorldSettings, invalidate: () => void) {
  const asked = options.quality?.resolution
  return {
    // The registry's resolved values, read where a session opens.
    get bounce() {
      return settings.get('bounce')
    },
    get temporalAntialiasing() {
      return settings.get('antialiasing')
    },
    get pixelError() {
      return settings.get('pixelError')
    },
    renderScale: options.renderScale ?? (asked ? renderScaleOf(asked) : ('auto' as RenderScale)),
    maxFrameRate: options.maxFrameRate ?? Infinity,
    // One chain for the world's life: every session draws it, a change asks for a frame. It starts
    // with the bloom a view draws by default.
    effects: createWorldEffects(invalidate),
    guides: createGuideSet(invalidate),
    // The particle pools the measurement entry attaches (`attachParticles`); none by default.
    particles: [] as ParticlePool[],
  }
}

/** The held switches (`heldSwitches`). */
type Held = ReturnType<typeof heldSwitches>

/** The three settings of the registry with a switch of their own, written into the open session
 *  in place when their resolved value changes. */
function watchSettings(
  settings: WorldSettings,
  runtime: () => SwitchedRuntime,
  invalidate: () => void,
) {
  settings.watch('bounce', (on) => {
    runtime().explorer?.setBounce(on)
    invalidate()
  })
  settings.watch('antialiasing', (level) => {
    runtime().explorer?.setTemporalAntialiasing(level)
    invalidate()
  })
  settings.watch('pixelError', (value) => {
    runtime().explorer?.setPixelError(value)
    invalidate()
  })
}

/** Writes into the session just `opened` each switch the page changed since it was `given` its
 *  options. */
function applyHeld(
  held: Held,
  families: ReturnType<typeof worldFamilies>,
  opened: MeasuredWorld,
  given: MeasuredWorldOptions,
) {
  if (held.bounce !== given.bounce) opened.setBounce(held.bounce)
  if (held.temporalAntialiasing !== given.temporalAntialiasing)
    opened.setTemporalAntialiasing(held.temporalAntialiasing)
  if (held.pixelError !== given.pixelError) opened.setPixelError(held.pixelError)
  for (const family of Object.values(families)) family.apply(opened, given)
  if (held.renderScale !== given.renderScale) opened.setRenderScale(held.renderScale)
  if (held.maxFrameRate !== given.maxFrameRate) opened.setMaxFrameRate(held.maxFrameRate)
}

/** `base` with the accessors of `parts` defined on it, as written: a getter stays a getter, so
 *  the object reads and writes its sources at every call, never a copy. */
function composed<
  T extends object,
  A extends object,
  B extends object,
  C extends object,
  D extends object,
  E extends object,
>(base: T, ...parts: [A, B, C, D, E]) {
  for (const part of parts) Object.defineProperties(base, Object.getOwnPropertyDescriptors(part))
  return base as T & A & B & C & D & E
}

/** The switches with a setting of the registry of their own: bounced light, temporal antialiasing
 *  (and the scene's level) and the cut's screen error, written at the page's priority. */
function pageAccessors(held: Held, settings: WorldSettings) {
  return {
    get bounce() {
      return held.bounce
    },
    set bounce(on: boolean) {
      settings.set('bounce', on, 'page')
    },
    /** The level asked, resolved over the page, the preset and the scene; whether the image
     *  carries it is the `'temporal antialiasing'` capability. */
    get temporalAntialiasing(): TemporalAntialiasingLevel {
      return held.temporalAntialiasing
    },
    /** The page's level; `undefined` or `null` gives the setting back to the preset and the scene. */
    set temporalAntialiasing(option: TemporalAntialiasingOption | null | undefined) {
      if (option == null) settings.clear('antialiasing', 'page')
      else settings.set('antialiasing', temporalAntialiasingLevel(option), 'page')
    },
    /** A loaded scene's level (`TEMPORAL_AA_FIELD` of its manifest): the `scene` setting, the
     *  first scene naming one deciding for the world's life. */
    sceneTemporalAntialiasing(level: TemporalAntialiasingLevel) {
      if (!settings.holds('antialiasing', 'scene')) settings.set('antialiasing', level, 'scene')
    },
    get pixelError() {
      return held.pixelError
    },
    set pixelError(value: number) {
      settings.set('pixelError', value, 'page')
    },
  }
}

/** The software raster's two settings and the rasterizer's and geometry streaming's families by
 *  rule: read, their settings resolved over the page and the preset, by field — what a session
 *  opens with — (`ruledSwitches`). */
function rasterAccessors(families: ReturnType<typeof worldFamilies>) {
  return {
    /** The software raster, resolved over the page and the preset. */
    get softwareRaster(): boolean {
      return families.raster.get('softwareRaster')
    },
    /** The page's software raster; `undefined` or `null` gives the setting back to the preset. */
    set softwareRaster(option: boolean | null | undefined) {
      families.raster.set({ softwareRaster: option })
    },
    /** The hardware raster edge in pixels, resolved over the page and the preset. */
    get hardwareRasterEdgePixels(): number {
      return families.raster.get('hardwareRasterEdgePixels')
    },
    /** The page's hardware raster edge; `undefined` or `null` gives the setting back to the
     *  preset. */
    set hardwareRasterEdgePixels(option: number | null | undefined) {
      families.raster.set({ hardwareRasterEdgePixels: option })
    },
    // Each family by rule: read, its settings resolved over the page and the preset, by field —
    // what a session opens with —; written, the page's settings the options name (`ruledSwitches`).
    get raster() {
      return families.raster.values()
    },
    get streaming() {
      return families.streaming.values()
    },
  }
}

/** The other families by rule: read, their settings resolved over the page and the preset, by
 *  field; written, the page's settings the options name (`ruledSwitches`). */
function ruledAccessors(families: ReturnType<typeof worldFamilies>) {
  return {
    get worldStreaming() {
      return families.worldStreaming.values()
    },
    set worldStreaming(options: WorldStreamingOptions & HlodWarmupOptions) {
      families.worldStreaming.set(options)
    },
    get cut() {
      return families.cut.values()
    },
    set cut(options: CutOptions) {
      families.cut.set(options)
    },
    get animation() {
      return families.animation.values()
    },
    set animation(options: AnimationOptions) {
      families.animation.set(options)
    },
    get shading() {
      return families.shading.values()
    },
    set shading(options: ShadingOptions) {
      families.shading.set(options)
    },
    get exposureSettings() {
      return families.exposure.values()
    },
    set exposureSettings(options: ExposureOptions) {
      families.exposure.set(options)
    },
    get temporal() {
      return families.temporal.values()
    },
    set temporal(options: TemporalOptions) {
      families.temporal.set(options)
    },
    get hiz() {
      return families.hiz.values()
    },
    set hiz(options: HizOptions) {
      families.hiz.set(options)
    },
  }
}

/** The families by rule of the drawing: the sun's shadows, the screen probes, the reflections' trace,
 *  the volumetric fog, the tessellation, the image effects (motion blur, depth of field, bloom,
 *  film) and the screen-space ambient occlusion — read as `ruledAccessors` does. */
function drawingAccessors(families: ReturnType<typeof worldFamilies>) {
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
    /** The tessellation's settings (`tessellationOptions.ts`), resolved over the page and the preset. */
    get tessellation() {
      return families.tessellation.values()
    },
    set tessellation(options: TessellationOptions) {
      families.tessellation.set(options)
    },
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

/** The switches the open session answers: the render scale and the frame cap. */
function sessionAccessors(held: Held, runtime: () => SwitchedRuntime, invalidate: () => void) {
  return {
    /** The scale of the image the open session drew last, 1 before one opens. */
    get renderScale(): number {
      return runtime().explorer?.renderScale() ?? 1
    },
    set renderScale(scale: RenderScale) {
      if (scale === held.renderScale) return
      held.renderScale = scale
      runtime().explorer?.setRenderScale(scale)
      invalidate()
    },
    /** The world's frame cap, frames a second (`WorldOptions.maxFrameRate`). */
    get maxFrameRate() {
      return held.maxFrameRate
    },
    set maxFrameRate(rate: number) {
      if (rate === held.maxFrameRate) return
      held.maxFrameRate = rate
      runtime().explorer?.setMaxFrameRate(rate)
    },
  }
}

/**
 * The world's render switches — bounced light, temporal antialiasing, the cut's screen error, the
 * software raster and its hardware edge (`rasterOptions.ts`), the geometry streaming's eight
 * settings (`streamingOptions.ts`), the partition's streaming and the HLOD warm-up
 * (`worldStreamingOptions.ts`), the cut's occlusion, culls and level-of-detail bias
 * (`cutOptions.ts`), the animation's rest-pose screen size and how its banks play their tracks
 * (`animationOptions.ts`), the shading bins' mode (`shadingOptions.ts`), the exposure's twelve
 * automatic and ten local settings (`exposureOptions.ts`), the temporal pass's thin geometry
 * detection (`temporalOptions.ts`), the sun's shadow distance scale and far-shadow culling
 * (`shadowOptions.ts`), how the motion blur is drawn (`motionBlurOptions.ts`), how the bloom is drawn
 * (`bloomRules.ts`), the film effects
 * (`filmOptions.ts`) — each of those families by rule (`ruledSwitches`) —, the render scale, the
 * effect chain — and its guides: held
 * by the world, given to every session it opens (`held` and the families), the switches written
 * into the open one in place, the streaming's read at its next update. All but the last two are
 * settings of the world's registry (`settings`): the page writes them at its priority, a quality
 * preset (`quality`) below it, the first loaded scene whose manifest names a temporal
 * anti-aliasing level below that (`scene`), and each is applied once its resolved value changes.
 * The frame cap is held as asked and written into the open session's loop.
 * Temporal antialiasing reads the level resolved, as a view's does; the render scale reads back
 * what the open session draws, 1 before one opens. The chain is shared by
 * reference: a session reads it at every frame.
 * A session is given the switches when it starts opening and draws frames before it is open,
 * which no setter reaches: what the page changed meanwhile is written into it once open (`apply`).
 */
export function worldSwitches(
  options: WorldOptions,
  runtime: () => SwitchedRuntime,
  frames: { readonly last: FrameMetrics | null },
) {
  const invalidate = () => runtime().invalidate()
  const settings = createWorldSettings()
  // The page's own level, `true` included: it holds over a scene's and a preset's.
  if (options.temporalAntialiasing != null)
    settings.set('antialiasing', temporalAntialiasingLevel(options.temporalAntialiasing), 'page')
  // The families by rule (`worldFamilies`): the page's settings of each, read by its one
  // resolver; they hold over a preset's.
  const families = worldFamilies(settings)
  for (const family of Object.values(families)) family.page(options)
  const scale = {
    asked: () => held.renderScale,
    ask: (next: RenderScale) => void (switches.renderScale = next),
    drawn: () => frames.last,
  }
  const quality = createWorldQuality(settings, scale, options.quality)
  const held = heldSwitches(options, settings, invalidate)
  watchSettings(settings, runtime, invalidate)
  for (const family of Object.values(families)) family.watch(() => runtime().explorer, invalidate)
  const switches = composed(
    {
      held,
      settings,
      quality,
      /** Writes into the session just opened each switch the page changed since it was `given` its
       *  options. */
      apply(opened: MeasuredWorld, given: MeasuredWorldOptions) {
        applyHeld(held, families, opened, given)
      },
      /** The page's guides: one set for the world's life, drawn by every session it opens. */
      guides: held.guides as Guides,
    },
    pageAccessors(held, settings),
    rasterAccessors(families),
    ruledAccessors(families),
    drawingAccessors(families),
    sessionAccessors(held, runtime, invalidate),
  )
  return switches
}
