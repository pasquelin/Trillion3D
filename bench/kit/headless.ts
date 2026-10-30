/**
 * The example site's page helpers, headless: what a site example page imports from `../runtime/kit.js`
 * beside `controls` — the opening glide, the readouts, the view modes, the words — as the bench reads
 * them. The bench draws no panel and no counter over the scene, so a readout is a function that
 * writes nothing and the words are their keys; the opening glide poses the camera as the site's does,
 * frame by frame, for the page's replay paths.
 */

import { saturate } from '../../packages/math/src/scalar/reals.ts'

/** The curves a page's move eases on, as the site's kit: `t` from 0 to 1 (clamped) gives how far along it is. */
export const ease = {
  /** Slow at both ends, the smoothstep. */
  smooth: (t: number) => {
    const x = saturate(t)
    return x * x * (3 - 2 * x)
  },
  /** Slow at both ends, more sharply: a cubic in, then out. */
  inOut: (t: number) => {
    const x = saturate(t)
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
  },
  /** Fast at first, landing softly: a cubic out. */
  out: (t: number) => 1 - (1 - saturate(t)) ** 3,
}

/** The world as far as the opening goes: its loop and its camera controls. */
export interface OpeningWorld {
  onFrame(hook: (frame: { delta: number }) => void): () => void
  invalidate(): void
  controls?: { update(): unknown } | null
}

/** A camera glide: whether it still flies, and how to end it. */
export interface Opening {
  readonly gliding: boolean
  restart(): void
  stop(): void
  dispose(): void
}

/**
 * Poses the camera every frame with `pose(time)` — `time` the seconds the glide has run, exactly
 * `step` more each frame when `step` is given, else the frame's delta up to 50 ms —, then updates the
 * controls and asks for a frame; it ends when `pose` answers `false`. `pose(0)` runs at once. No
 * pointer ends it: the bench presses nothing.
 */
export function opening(
  world: OpeningWorld,
  pose: (time: number) => boolean | void,
  step?: number,
): Opening {
  let time = 0,
    gliding = true
  const place = () => {
    if (pose(time) === false) gliding = false
    world.controls?.update()
    world.invalidate()
  }
  const unhook = world.onFrame(({ delta }) => {
    if (!gliding) return
    time += step ?? Math.min(delta, 0.05)
    place()
  })
  place()
  return {
    get gliding() {
      return gliding
    },
    restart() {
      time = 0
      gliding = true
      place()
    },
    stop: () => void (gliding = false),
    dispose() {
      gliding = false
      unhook()
    },
  }
}

/** A counter the example writes every frame: nothing is drawn, so nothing is kept. */
export const readout =
  (_key: string): ((text: string) => void) =>
  () => {}

/** The view modes' buttons: the bench draws none. */
export const viewModes = (_world: object): void => {}

/** The example's words: a word is its key. */
export const words = (): ((key: string) => string) => (key) => key

/** The language numbers are written in. */
export const language = () => 'en'
