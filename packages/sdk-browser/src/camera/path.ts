import { frameStatistics, summarize } from '../../../sdk-core/src/index.ts'
import type { CameraPose, FrameMetrics } from '../../../sdk-core/src/index.ts'
import { nextFrame } from '../frame/scheduling.ts'

/** What a path run reads of the session: its frame and the view it draws. */
export type PathSession = {
  render(pose?: CameraPose): FrameMetrics
  readonly diagnostic: string
}

/** A path run measured: each frame's metrics, their CPU summary, and the display cadence. */
export type PathRun = {
  /** The metrics of each measured frame, in path order. */
  frames: FrameMetrics[]
  /** Their CPU frame times summarized. */
  cpu: ReturnType<typeof summarize>
  /** The cadence of the display frames they took. */
  cadence: ReturnType<typeof frameStatistics>
}

/**
 * The session's camera led along `path`, one display frame per pose, on the one engine, after
 * `warmup` frames drawn and not measured (four by default): the frames it drew, their CPU time
 * summarized, and the cadence of the display frames they took. The caller's poses are read, never
 * written; the camera ends on the last one, as any pose leaves it.
 */
export async function runCameraPath(
  session: PathSession,
  path: readonly CameraPose[],
  options: { warmup?: number; signal?: AbortSignal } = {},
): Promise<PathRun> {
  if (session.diagnostic !== 'beauty') throw new Error('A path run draws the beauty view')
  if (!path.length || path.length > 6000) throw new Error('Path must contain 1..6000 poses')
  const warmup = options.warmup ?? 4
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 600) throw new Error('Invalid warmup')
  const signal = options.signal ?? new AbortController().signal
  for (let i = 0; i < warmup; i++) {
    await nextFrame(signal)
    session.render(path[i % path.length])
  }
  const frames: FrameMetrics[] = []
  let previous: number | null = null
  for (const pose of path) {
    const raf = await nextFrame(signal)
    // A copy: the session hands the same metrics object back every frame.
    const frame = { ...session.render(pose) }
    frame.rafIntervalMs = previous === null ? null : raf - previous
    previous = raf
    frames.push(frame)
  }
  const intervals = frames.flatMap((f) => (f.rafIntervalMs === null ? [] : [f.rafIntervalMs]))
  return {
    frames,
    cpu: summarize(frames.map((f) => f.cpuFrameMs)),
    cadence: frameStatistics(intervals),
  }
}
