import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { dropTaaHistory } from '../../post/taa/landing.ts'
import { stochasticCycle, stochasticPhase } from '../../post/taa/frameState.ts'
import { isFinalImage } from './finalImage.ts'

/**
 * THE NOISE'S CLOCK: the image number the per-image noise is indexed by, counted from an anchor so that two worlds that reach the same view by other histories meet the same noise on the
 * image they hold. The anchor is the later of the light's start and the view's last change once the accumulation has been through a cycle of the noise since (until then the index never
 * breaks), and the final image of the establishment is drawn at zero. `beginNoiseImage` advances it once an image; `noiseFrame` only reads.
 */
export function noiseFrame(
  rt: Pick<WebgpuPagesRuntime, 'run' | 'surfaceCache' | 'lights' | 'context'>,
) {
  // A session that freezes its temporal sequences draws every image on the final image's phase.
  if (rt.context.freezeTemporalSequences === true) return 0
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
 * Advances the view's clock for the image about to be drawn or held, once; `quiet` says the view stands with everything else established, `accumulating` that a temporal pass runs
 * on this image (`taaRuns`). The index counts from the start of the burst of changes the image belongs to (changes less than a cycle of the noise apart, `stochasticCycle`): it never
 * breaks while the view keeps changing, whatever the history before. Once the view has been calm for a cycle it counts from the last change, and the first quiet image jumps it to
 * zero. Returns whether the image must be drawn for the clock: within the cycle, or the final image. A term unsettled again after the final image continues the index from it.
 */
export function beginNoiseImage(
  rt: Pick<WebgpuPagesRuntime, 'run' | 'surfaceCache' | 'lights' | 'gpu'>,
  quiet: boolean,
  accumulating: boolean,
) {
  const { run } = rt
  const { hold } = run.gate
  const clock = hold.noise
  const sample = stochasticPhase(rt.gpu.temporal?.frame),
    cycle = stochasticCycle(accumulating)
  // Changed: a revision moved since the frame the gate kept, or one moved while that frame was drawn (a tile landed), which leaves the witness unstable; counted once. The temporal
  // pass turning on or off changes the noise as well, and so does the light beginning, which also starts the temporal history again: it was accumulated on a noise frozen at zero
  // (`noiseFrame`), which no later image averages away.
  const start = lightStart(rt)
  const lit = start !== undefined
  const lightBegan = lit && !clock.lit
  const changed =
    !hold.same(run.gate.revisions) ||
    (hold.stable === false && !clock.changed) ||
    accumulating !== clock.accumulating ||
    lit !== clock.lit
  clock.changed = changed
  clock.accumulating = accumulating
  clock.lit = lit
  if (lightBegan) dropTaaHistory(rt.gpu.temporal?.frame)
  if (changed) {
    if (clock.changedAt === -Infinity || sample - clock.sampleAt >= cycle) clock.anchor = run.frame
    clock.changedAt = run.frame
    clock.sampleAt = sample
    return (clock.final = false)
  }
  const established = quiet && lit
  if (sample - clock.sampleAt < cycle) return established
  // The cycle is over: the index counts from the last change, once.
  if (clock.calmAt !== clock.changedAt) {
    clock.calmAt = clock.changedAt
    clock.anchor = clock.changedAt
  }
  if (!established) {
    if (clock.anchor < run.frame) clock.final = false
    return false
  }
  // A final image drawn before the light began is not the final one: the light's start moves no revision.
  if (!clock.final || clock.anchor < start) {
    clock.anchor = run.frame
    clock.final = true
  }
  return isFinalImage(run)
}

/** The images drawn since the view last changed (a revision moved, in or between images): what a temporal history has had to follow the change; unbounded for a view that never changed. */
export const imagesSinceChange = (run: WebgpuPagesRuntime['run']) =>
  run.frame - (run.gate?.hold?.noise?.changedAt ?? -Infinity)

/** Whether the surface cache's light can begin in this session: it lights the scene's lights from their buffer, and a store with no lit light has none. */
const lightCanBegin = ({ lights }: Pick<WebgpuPagesRuntime, 'lights'>) =>
  !!lights?.buffer && !lights.store.unlit
