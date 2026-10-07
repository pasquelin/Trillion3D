import type { MeasuredWorld } from '../session/explorer.ts'
import type { WorldOptions } from './worldOptions.ts'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { createGuideSet, type Guides } from '../../guides/guideSet.ts'
import type { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts'
import { createWorldSettings } from './worldSettings.ts'
import { createWorldQuality, renderScaleOf } from './worldQuality.ts'

/** What of the world's runtime the switches reach: its open session and a frame. */
interface SwitchedRuntime {
  readonly explorer: MeasuredWorld | null
  invalidate(): void
}

/**
 * The world's render switches — bounced light, temporal antialiasing, the cut's screen error, the
 * render scale, the effect chain — and its guides: held by the world, given to every session it
 * opens (`held`), the switches written into the open one in place. The first three are settings of the world's registry (`settings`): the page
 * writes them at its priority, a quality preset (`quality`) below it, and each is applied once its
 * resolved value changes.
 * Temporal antialiasing and the render scale read back what the open session draws; before one
 * opens, what the page asked (`world.temporalAntialiasing`), and 1. The chain is shared by
 * reference: a session reads it at every frame.
 */
export function worldSwitches(
  options: WorldOptions,
  runtime: () => SwitchedRuntime,
  frames: { readonly last: FrameMetrics | null },
) {
  const invalidate = () => runtime().invalidate()
  const settings = createWorldSettings()
  if (options.temporalAntialiasing === false) settings.set('antialiasing', false, 'page')
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
  settings.watch('antialiasing', (on) => {
    runtime().explorer?.setTemporalAntialiasing(on)
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
    /** The page's guides: one set for the world's life, drawn by every session it opens. */
    guides: held.guides as Guides,
    get bounce() {
      return held.bounce
    },
    set bounce(on: boolean) {
      settings.set('bounce', on, 'page')
    },
    get temporalAntialiasing() {
      const session = runtime().explorer
      if (session) return session.temporalAntialiasing()
      return held.temporalAntialiasing
    },
    set temporalAntialiasing(on: boolean) {
      settings.set('antialiasing', on, 'page')
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
  }
  return switches
}
