// Whether a segment's timers can be believed: a doubt is named, never a silent number. A pass that
// reads zero with work encoded, a timer the driver never wrote, passes whose sum is not the frame, a bench timer the
// engine's own contradicts, a frame time too dispersed to give a median.
import type { BenchPass } from './benchPasses.ts'
import type { Spread } from './summary.ts'

/** The most the passes' sum may differ from the frame's median, as a share of it. */
export const SUM_TOLERANCE = 0.1
/** The most the bench's frame time may differ from the engine's own, as a share of it. */
export const ENGINE_TOLERANCE = 0.25
/** The most the middle half of the frames may span, as a share of their median. */
export const DISPERSION_LIMIT = 0.25

/** The doubts a segment's numbers raise, each a sentence naming what and by how much. */
export function timerDoubts(input: {
  passes: readonly BenchPass[]
  frame: Spread | null
  engineFrame: Spread | null
}) {
  const doubts: string[] = []
  const { passes, frame, engineFrame } = input
  for (const pass of passes) {
    if (pass.lost)
      doubts.push(
        `timer lost: "${pass.name}" encoded work and had no timestamp in ${pass.lost} runs`,
      )
    else if (pass.unknown)
      doubts.push(
        `unknown: "${pass.name}" has only indirect work and no timestamp in ${pass.unknown} runs: no size, or a lost timer`,
      )
  }
  if (frame) {
    const sum = passes.reduce((total, pass) => total + pass.median, 0)
    const off = Math.abs(sum - frame.median) / frame.median
    if (off > SUM_TOLERANCE)
      doubts.push(
        `passes sum ${sum.toFixed(2)} ms, the frame ${frame.median.toFixed(2)} ms (${(off * 100).toFixed(0)} % apart)`,
      )
    if (frame.iqr / frame.median > DISPERSION_LIMIT)
      doubts.push(
        `frame time dispersed: the middle half spans ${((frame.iqr / frame.median) * 100).toFixed(0)} % of the median`,
      )
  }
  if (frame && engineFrame && engineFrame.median > 0) {
    const off = Math.abs(frame.median - engineFrame.median) / engineFrame.median
    if (off > ENGINE_TOLERANCE)
      doubts.push(
        `bench timer ${frame.median.toFixed(2)} ms against the engine's ${engineFrame.median.toFixed(2)} ms (${(off * 100).toFixed(0)} % apart)`,
      )
  }
  return doubts
}
