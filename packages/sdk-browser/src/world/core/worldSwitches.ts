import type { MeasuredWorld } from '../session/explorer.ts'
import type { MeasuredWorldOptions } from '../session/options.ts'
import type { WorldOptions } from './worldOptions.ts'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { createGuideSet, type Guides } from '../../guides/guideSet.ts'
import type { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { createWorldSettings } from './worldSettings.ts'
import { createWorldQuality, renderScaleOf } from './worldQuality.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  resolveTemporalAntialiasing,
  type TemporalAntialiasingOption,
} from '../../../../sdk-core/src/contracts/materialOptions.ts'

/** The level `option` names, `true` the default one, `false` off; refused when it is no level. */
const levelOf = (option: TemporalAntialiasingOption): TemporalAntialiasingLevel =>
  resolveTemporalAntialiasing(option)!

/** What of the world's runtime the switches reach: its open session and a frame. */
interface SwitchedRuntime {
  readonly explorer: MeasuredWorld | null
  invalidate(): void
}

/**
 * The world's render switches — bounced light, temporal antialiasing, the cut's screen error, the
 * render scale, the effect chain — and its guides: held by the world, given to every session it
 * opens (`held`), the switches written into the open one in place. The first three are settings of the world's registry (`settings`): the page
 * writes them at its priority, a quality preset (`quality`) below it, the first loaded scene whose
 * manifest names a temporal anti-aliasing level below that (`scene`), and each is applied once its
 * resolved value changes.
 * The frame cap is held as asked and written into the open session's loop.
 * Temporal antialiasing and the render scale read back what the open session draws — the level,
 * `'off'` while the image carries none —; before one opens, the level resolved
 * (`world.temporalAntialiasing`), and 1. The chain is shared by
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
  if (options.temporalAntialiasing !== undefined)
    settings.set('antialiasing', levelOf(options.temporalAntialiasing), 'page')
  const scale = {
    asked: () => held.renderScale,
    ask: (next: RenderScale) => void (switches.renderScale = next),
    drawn: () => frames.last,
  }
  const quality = createWorldQuality(settings, scale, options.quality)
  const asked = options.quality?.resolution
  const held = {
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
    // One chain for the world's life: every session draws it, a change asks for a frame.
    effects: new EffectChain(invalidate),
    guides: createGuideSet(invalidate),
    // The particle pools the measurement entry attaches (`attachParticles`); none by default.
    particles: [] as ParticlePool[],
  }
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
  const switches = {
    held,
    settings,
    quality,
    /** Writes into the session just opened each switch the page changed since it was `given` its
     *  options. */
    apply(opened: MeasuredWorld, given: MeasuredWorldOptions) {
      if (held.bounce !== given.bounce) opened.setBounce(held.bounce)
      if (held.temporalAntialiasing !== given.temporalAntialiasing)
        opened.setTemporalAntialiasing(held.temporalAntialiasing)
      if (held.pixelError !== given.pixelError) opened.setPixelError(held.pixelError)
      if (held.renderScale !== given.renderScale) opened.setRenderScale(held.renderScale)
      if (held.maxFrameRate !== given.maxFrameRate) opened.setMaxFrameRate(held.maxFrameRate)
    },
    /** The page's guides: one set for the world's life, drawn by every session it opens. */
    guides: held.guides as Guides,
    get bounce() {
      return held.bounce
    },
    set bounce(on: boolean) {
      settings.set('bounce', on, 'page')
    },
    get temporalAntialiasing(): TemporalAntialiasingLevel {
      const session = runtime().explorer
      if (session && !session.temporalAntialiasing()) return 'off'
      return held.temporalAntialiasing
    },
    set temporalAntialiasing(option: TemporalAntialiasingOption) {
      settings.set('antialiasing', levelOf(option), 'page')
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
  return switches
}
