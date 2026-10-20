import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts'
import type { FrameMetrics } from '../../../packages/sdk-core/src/contracts/metrics.ts'
import type { TrajectoryCheckpoint } from './trajectoryProof.ts'
import { HOLD_FRAME_LIMIT } from '../harness/measurePage.ts'
import { upscalePhases } from '../../../packages/sdk-browser/src/post/taa/jitter.ts'
import { alignUp } from '../../../packages/math/src/scalar/integers.ts'

interface TrajectoryPort {
  render(pose: CameraPose): Partial<FrameMetrics>
  nextFrame(): Promise<unknown>
  capture(name: string): Promise<string>
  /** A view cut: the temporal history dropped, its jitter back to phase zero. */
  resetHistory(): void
  /** The display's width in pixels, which the jitter's phases are counted against. */
  displayWidth(): number
}

/** Unlike the bench's flush barrier, every convergence render is explicit and observed here. */
export async function walkTrajectory(
  port: TrajectoryPort,
  poses: CameraPose[],
  indices: number[],
  prefix: string,
  captureArrival: boolean,
) {
  const checkpoints: TrajectoryCheckpoint[] = [],
    coverageFailures: number[] = [],
    incidents: string[] = []
  let drawn = false
  const render = async (pose: CameraPose, index: number) => {
    await port.nextFrame()
    const frame = port.render(pose)
    if (frame.streamingError) incidents.push(frame.streamingError)
    if (
      frame.uncoveredTriangles !== 0 ||
      typeof frame.drawnTriangles !== 'number' ||
      frame.drawnTriangles !== frame.selectedTriangles
    )
      coverageFailures.push(index)
    drawn ||= typeof frame.drawnTriangles === 'number' && frame.drawnTriangles > 0
    return frame
  }
  // From a history reset, a whole number of the jitter's phase cycles, `HOLD_FRAME_LIMIT` frames at
  // least, so every settled image is captured at the same phase of the same history: the bench's
  // sessions draw the temporal pass every frame, converged too (`drawConverged`). Fewer where the
  // engine holds earlier, a view without temporal accumulation.
  const settle = async (pose: CameraPose, index: number) => {
    port.resetHistory()
    const first = await render(pose, index)
    if (first.frameHeld === true) return 1
    const display = port.displayWidth(),
      phases = upscalePhases(first.renderWidth ?? display, display),
      frames = alignUp(HOLD_FRAME_LIMIT, phases)
    for (let count = 2; count <= frames; count++)
      if ((await render(pose, index)).frameHeld === true) return count
    return frames
  }
  if (!poses.length) throw new Error('empty trajectory')
  await settle(poses[0], -1)
  const checked = new Set(indices)
  for (const [index, pose] of poses.entries()) {
    const frame = await render(pose, index)
    if (!checked.has(index)) continue
    // Backends reuse their metrics object on later renders.
    const pagesRequested = frame.pagesRequested ?? null
    const residentPages = frame.residentPages ?? null
    const name = `${prefix}-${index}`
    const arrival = captureArrival ? await port.capture(`${name}-arrival.png`) : null
    const settleFrames = await settle(pose, index)
    checkpoints.push({
      index,
      arrival,
      settleFrames,
      settled: await port.capture(`${name}-settled.png`),
      pagesRequested,
      residentPages,
    })
  }
  return { checkpoints, coverageFailures, drawn, incidents }
}
