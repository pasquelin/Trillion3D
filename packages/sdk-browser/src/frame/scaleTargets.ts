/** What the render-scale control and its targets share (`scaleControl.ts`): the refresh
 *  assumed before the display's is measured, and an interval long enough to be a pause (a hidden
 *  page), not a frame. */
export const FALLBACK_REFRESH_MS = 1000 / 60,
  INTERVAL_PAUSE_MS = 500
/** What the controller reads: the share of the budget they aim at, the display frames a sample is
 *  kept, the relative change below which the scale holds, and the display frames between two moves. */
export const HEADROOM = 0.9,
  HISTORY = 16,
  THRESHOLD = 0.02,
  PERIOD = 8
/** A memory cap (`createTargetCap`) holds the targets an eighth of the display below the refused
 *  ones. */
const ALLOCATION_STEP = 8
/** `scale` up to the next eighth of the display. */
const rung = (scale: number) => Math.ceil(scale * ALLOCATION_STEP - 1e-9) / ALLOCATION_STEP

/** Writes the display the page is on into `into`; true when it changed. Read at each frame:
 *  another size or pixel ratio (a window moved to another screen) resets what was measured on the
 *  last one. Numbers compared in place, no key made a frame. */
export function displayMoved(into: { width: number; height: number; ratio: number }) {
  const screen = globalThis.screen,
    width = screen ? screen.width : 0,
    height = screen ? screen.height : 0,
    ratio = screen ? globalThis.devicePixelRatio : 0
  if (width === into.width && height === into.height && ratio === into.ratio) return false
  into.width = width
  into.height = height
  into.ratio = ratio
  return true
}

/**
 * The scale the render targets are made at, under the render-scale controller
 * (`scaleControl.ts`): the bounds' maximum, whatever the scale drawn in their top-left corner —
 * allocated once at the maximum, since resizing them pops —, under the cap the GPU budget set at the view size it was learnt at (`lower`): the
 * targets one eighth below the refused ones while the view keeps that size, until `lift` says the
 * room came back. Fields, stored in place.
 */
export function createTargetCap(max: number) {
  const at = { made: max, cap: Infinity, view: '' }
  const targets = {
    /** The scale the targets of a `view` size are made at, the bounds' `max` at most. */
    allocated(max: number, view: string) {
      at.made = Math.min(max, view === at.view ? at.cap : Infinity)
      return at.made
    },
    /** The budget refused the targets of the `view` size: the cap one eighth below them, which the
     *  controller's scale must hold under too; NaN at the bounds' `min`, where none is below. */
    lower(min: number, view: string) {
      const below = at.made - 1 / ALLOCATION_STEP
      if (below < rung(min) - 1e-9) return Number.NaN
      at.cap = at.made = below
      at.view = view
      return below
    },
    /** The room came back: no cap. */
    lift() {
      at.cap = Infinity
    },
    /** Other bounds: the targets at their `max`, no cap. */
    reset(max: number) {
      at.made = max
      at.cap = Infinity
    },
    /** Whether a cap holds the targets below the bounds' maximum. */
    get capped() {
      return at.cap !== Infinity
    },
  }
  return targets
}
