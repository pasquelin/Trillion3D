import type { MeasuredWorld } from '../explorer.ts'
import type { MeasuredWorldOptions } from '../options.ts'
import type { WorldOptions } from './options.ts'
import { createWorldEffects } from '../../../../sdk-core/src/world/effect/defaultChain.ts'
import { createGuideSet, type Guides } from '../../guides/guideSet.ts'
import type { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { UnionToIntersection } from '../../../../sdk-core/src/runtime/joined.ts'
import { createWorldSettings, type WorldSettings } from './settings.ts'
import { createWorldQuality, renderScaleOf } from './quality.ts'
import { QUALITY_LEVELS } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import type { QualityBenchmark } from './benchmarkSource.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  temporalAntialiasingLevel,
  type TemporalAntialiasingOption,
} from '../../../../sdk-core/src/contracts/materialOptions.ts'
import { worldFamilies } from './ruledSwitches.ts'
import { rasterAccessors, ruledAccessors } from './ruledAccessors.ts'

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
    renderScale: (options.renderScale ?? (asked ? renderScaleOf(asked) : undefined)) as
      RenderScale | undefined,
    maxFrameRate: options.maxFrameRate ?? Infinity,
    // One chain for the world's life: every session draws it, a change asks for a frame. It starts
    // with the bloom a view draws by default.
    effects: createWorldEffects(invalidate),
    guides: createGuideSet(invalidate),
    // The particle pools the world's emitters attach (`world.particles`); none by default.
    particles: [] as ParticlePool[],
  }
}

/** The held switches (`heldSwitches`). */
type Held = ReturnType<typeof heldSwitches>

/** The members of the world's switches that are no accessors: the held values and settings, the
 *  quality, `apply` — which writes into the session just opened each switch the page changed since
 *  it was `given` its options —, the page's guides (one set for the world's life, drawn by every
 *  session it opens) and `dispose`, which stops a benchmark run the world's quality asked. */
type WorldBase = {
  held: Held
  settings: WorldSettings
  quality: ReturnType<typeof createWorldQuality>['quality']
  /** Settled once the quality is decided (`createWorldQuality`): the world's first session opens after it. */
  decided(): Promise<void>
  apply(opened: MeasuredWorld, given: MeasuredWorldOptions): void
  guides: Guides
  dispose(): void
}

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
function composed<T extends object, P extends object[]>(base: T, ...parts: P) {
  for (const part of parts) Object.defineProperties(base, Object.getOwnPropertyDescriptors(part))
  return base as T & UnionToIntersection<P[number]>
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

/** Writes `scale` into the held switches and the open session. */
function writeRenderScale(
  held: Held,
  runtime: () => SwitchedRuntime,
  invalidate: () => void,
  scale: RenderScale | undefined,
) {
  if (scale === held.renderScale) return
  held.renderScale = scale
  runtime().explorer?.setRenderScale(scale)
  invalidate()
}

/** The render scale as the world's quality writes it (`createWorldQuality`): the page asks through
 *  `ask`. */
function qualityScale(
  options: WorldOptions,
  held: Held,
  runtime: () => SwitchedRuntime,
  invalidate: () => void,
  frames: { readonly last: FrameMetrics | null },
  ask: (next: RenderScale) => void,
) {
  return { asked: () => held.renderScale, ask, drawn: () => frames.last }
}

/** The switches the open session answers: the render scale and the frame cap. */
function sessionAccessors(held: Held, runtime: () => SwitchedRuntime, invalidate: () => void) {
  return {
    /** The scale of the image the open session drew last, 1 before one opens. */
    get renderScale(): number {
      return runtime().explorer?.renderScale() ?? 1
    },
    set renderScale(scale: RenderScale) {
      writeRenderScale(held, runtime, invalidate, scale)
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
 * `benchmark` makes the quality's hardware benchmark (`benchmarkSource.ts`), stopped by `dispose`;
 * without it, the world has none.
 */
export function worldSwitches(
  options: WorldOptions,
  runtime: () => SwitchedRuntime,
  frames: { readonly last: FrameMetrics | null },
  benchmark?: (signal: AbortSignal) => QualityBenchmark,
): WorldSwitches {
  const invalidate = () => runtime().invalidate()
  const settings: WorldSettings = createWorldSettings()
  // The page's own level, `true` included: it holds over a scene's and a preset's.
  if (options.temporalAntialiasing != null)
    settings.set('antialiasing', temporalAntialiasingLevel(options.temporalAntialiasing), 'page')
  // The families by rule (`worldFamilies`): the page's settings of each, read by its one
  // resolver; they hold over a preset's.
  const families = worldFamilies(settings)
  for (const family of Object.values(families)) family.page(options)
  const held = heldSwitches(options, settings, invalidate)
  const ask = (next: RenderScale) => void (switches.renderScale = next)
  const scale = qualityScale(options, held, runtime, invalidate, frames, ask)
  const stop = new AbortController()
  const made = benchmark?.(stop.signal)
  const { quality, decided } = createWorldQuality(
    settings,
    scale,
    options.quality,
    QUALITY_LEVELS,
    made,
  )
  watchSettings(settings, runtime, invalidate)
  for (const family of Object.values(families)) family.watch(() => runtime().explorer, invalidate)
  const base: WorldBase = {
    held,
    settings,
    quality,
    decided,
    apply(opened, given) {
      applyHeld(held, families, opened, given)
    },
    guides: held.guides,
    dispose: () => stop.abort(),
  }
  const switches = composed(
    base,
    pageAccessors(held, settings),
    rasterAccessors(families),
    ruledAccessors(families),
    sessionAccessors(held, runtime, invalidate),
  )
  return switches
}
/** What `worldSwitches` builds, named part by part, so the types that hold it refer to its parts
 *  rather than spell them out. */
export type WorldSwitches = WorldBase &
  ReturnType<typeof pageAccessors> &
  ReturnType<typeof rasterAccessors> &
  ReturnType<typeof ruledAccessors> &
  ReturnType<typeof sessionAccessors>
