import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * THE NOISE'S CLOCK: the image number the per-image noise is indexed by (blue noise, grain, dither, clouds, atmosphere, fog, probes), counted from one anchor instead of
 * the image number since the opening, so that two worlds that reach the same view by other histories meet the same noise on the image they hold.
 * The anchor is the latest of the surface cache's light start, the view's last change (a motion keeps it at the opening: the noise turns with the view) and the final image
 * of its establishment, drawn at zero. The clock is advanced once an image, by the hold's decision (`beginNoiseImage`); `noiseFrame` only reads it.
 */
export function noiseFrame(rt: Pick<WebgpuPagesRuntime, 'run' | 'surfaceCache' | 'lights'>) {
  const start = lightStart(rt)
  // The light has not begun: zero while it will (the view is not held meanwhile).
  if (start === undefined) return 0
  const anchor = rt.run.gate?.hold?.noise?.anchor ?? 0
  return Math.max(0, rt.run.frame - Math.max(start, anchor))
}

/** The image the surface cache's light began on: zero with no cache or no light to begin, `undefined` while it can begin and has not. */
function lightStart(rt: Pick<WebgpuPagesRuntime, 'surfaceCache' | 'lights'>) {
  const cache = rt.surfaceCache
  if (!cache) return 0
  const begunAt = cache.lighting?.begunAt
  return begunAt === undefined && lightCanBegin(rt) ? undefined : (begunAt ?? 0)
}

/**
 * Advances the view's clock for the image about to be drawn or held, once; `quiet` says the view stands with everything else established. Returns whether this image is the
 * final one: the first quiet image since the last change jumps the anchor to itself (noise zero), is drawn, and the view is held on it. An image drawn after it ends it.
 */
export function beginNoiseImage(
  rt: Pick<WebgpuPagesRuntime, 'run' | 'surfaceCache' | 'lights'>,
  quiet: boolean,
) {
  const { run } = rt
  const { hold } = run.gate
  const clock = hold.noise
  // Changed: a revision moved since the frame the gate kept, or one moved while that frame was drawn (a tile landed), which leaves the witness unstable; counted once.
  const changed = !hold.same(run.gate.revisions) || (hold.stable === false && !clock.changed)
  const moving = changed && clock.changed
  // A motion keeps the anchor at the opening; the first image still counts from the last one that changed.
  if (changed) clock.anchor = moving ? 0 : run.frame
  else if (clock.changed) clock.anchor = run.frame - 1
  clock.changed = changed
  if (changed) {
    clock.changedAt = run.frame
    return (clock.final = false)
  }
  const start = lightStart(rt)
  if (!quiet || start === undefined) {
    if (clock.anchor < run.frame) clock.final = false
    return false
  }
  // A final image drawn before the light began is not the final one: the light's start moves no revision.
  if (!clock.final || clock.anchor < start) {
    clock.anchor = run.frame
    clock.final = true
  }
  return clock.anchor === run.frame
}

/** The images drawn since the view last changed (a revision moved, in or between images): what a temporal history has had to follow the change; unbounded for a view that never changed. */
export const imagesSinceChange = (run: WebgpuPagesRuntime['run']) =>
  run.frame - (run.gate?.hold?.noise?.changedAt ?? -Infinity)

/** What the clock holds of the view, for a proof that prints it. */
export const noiseAnchors = (run: WebgpuPagesRuntime['run']) => run.gate.hold.noise

/** Whether the surface cache's light can begin in this session: it lights the scene's lights from their buffer, and a store with no lit light has none. */
const lightCanBegin = ({ lights }: Pick<WebgpuPagesRuntime, 'lights'>) =>
  !!lights?.buffer && !lights.store.unlit
