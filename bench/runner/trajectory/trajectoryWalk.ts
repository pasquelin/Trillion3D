import type { CameraPose, FrameMetrics } from '../../../packages/sdk-core/src/index.ts'
import type { TrajectoryCheckpoint } from './trajectoryProof.ts'
import { HOLD_FRAME_LIMIT } from '../harness/measurePage.ts'

interface TrajectoryPort {
  render(pose: CameraPose): Partial<FrameMetrics>
  nextFrame(): Promise<void>
  capture(name: string): Promise<string>
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
  const settle = async (pose: CameraPose, index: number) => {
    for (let count = 1; count <= HOLD_FRAME_LIMIT; count++)
      if ((await render(pose, index)).frameHeld === true) return count
    return null
  }
  if (!poses.length) throw new Error('empty trajectory')
  if ((await settle(poses[0], -1)) === null)
    throw new Error(`initial pose did not settle within ${HOLD_FRAME_LIMIT} frames`)
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
