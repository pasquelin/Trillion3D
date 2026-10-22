import type { CpuStepReader, CpuStepWindow } from '../../diagnostic/stage/profiler.ts'
import type { MeasuredWorld } from '../explorer.ts'

/** A CPU step window that follows `live`'s session: opened at once on the live session, closed and
 *  opened again on the next when the world's session changes (the read that opens a window is
 *  `null`); `read` is `null` with none open, after the world is disposed (`disposed`, which `live`
 *  throws for), and after `close`; the result is typed as the `read` and `close` pair. */
function followingCpuSteps(
  live: () => MeasuredWorld | null,
  disposed: () => boolean,
): CpuStepReader {
  let session: MeasuredWorld | null = null,
    window: CpuStepWindow | null = null,
    closed = false
  const release = () => {
    window?.close()
    window = session = null
  }
  /** Follows the live session; true when it opened a new window. */
  const follow = () => {
    const now = disposed() ? null : live()
    if (now === session) return false
    release()
    session = now
    window = now?.openCpuSteps() ?? null
    return true
  }
  follow()
  return {
    read() {
      if (closed || follow()) return null
      return window?.read() ?? null
    },
    close() {
      closed = true
      release()
    },
  }
}

/** `world.stageProfile`, `world.cpuSteps` and `world.resetCpuSteps`: the open session's per-step
 *  CPU profile, read through `live` so a disposed world still throws and a session not yet open
 *  reads as unmeasured rather than missing. */
export function worldTelemetry(live: () => MeasuredWorld | null, disposed: () => boolean) {
  return {
    /** Per-step profile of the session's frames. */
    stageProfile: () => live()?.stageProfile() ?? null,
    /** CPU bounds of the frames since `resetCpuSteps()` (p50, p95, max per step); `null` unmeasured.
     *  Outside debug mode it stays empty: only a reader window (`openCpuSteps`) files the rows it reads. */
    cpuSteps: () => live()?.cpuSteps() ?? null,
    /** Opens a new `cpuSteps()` window. */ resetCpuSteps: () => live()?.resetStageProfile(),
    /** A CPU step window of the caller's own over the session's frames, which neither
     *  `resetCpuSteps` nor another reader moves, following the world's session (`followingCpuSteps`);
     *  `close` it when done. */
    openCpuSteps: () => followingCpuSteps(live, disposed),
  }
}
