import type { CameraPose, FrameMetrics } from '../../packages/sdk-core/src/index.ts';
import type { TrajectoryCheckpoint } from './trajectoryProof.ts';

interface TrajectoryPort {
  render(pose: CameraPose): Partial<FrameMetrics>;
  nextFrame(): Promise<void>;
  capture(name: string): Promise<string>;
}

/** Unlike the bench's flush barrier, every convergence render is explicit and observed here. */
export async function walkTrajectory(
  port: TrajectoryPort,
  poses: CameraPose[],
  indices: number[],
  prefix: string,
) {
  const checkpoints: TrajectoryCheckpoint[] = [],
    coverageFailures: number[] = [],
    incidents: string[] = [];
  let drawn = false;
  const render = async (pose: CameraPose, index: number) => {
    await port.nextFrame();
    const frame = port.render(pose);
    if (frame.streamingError) incidents.push(frame.streamingError);
    if (
      frame.uncoveredTriangles !== 0 ||
      typeof frame.drawnTriangles !== 'number' ||
      frame.drawnTriangles !== frame.selectedTriangles
    )
      coverageFailures.push(index);
    drawn ||= typeof frame.drawnTriangles === 'number' && frame.drawnTriangles > 0;
    return frame;
  };
  const settle = async (pose: CameraPose, index: number) => {
    for (let count = 1; count <= 64; count++)
      if ((await render(pose, index)).frameHeld === true) return count;
    return null;
  };
  if (!poses.length) throw new Error('empty trajectory');
  if ((await settle(poses[0], -1)) === null)
    throw new Error('initial pose did not settle within 64 frames');
  for (const [index, pose] of poses.entries()) {
    const frame = await render(pose, index);
    if (!indices.includes(index)) continue;
    const name = `${prefix}-${index}`;
    const arrival = prefix === 'candidate' ? await port.capture(`${name}-arrival.png`) : null;
    const settleFrames = await settle(pose, index);
    checkpoints.push({
      index,
      arrival,
      settleFrames,
      settled: await port.capture(`${name}-settled.png`),
      pagesRequested: frame.pagesRequested ?? null,
      residentPages: frame.residentPages ?? null,
    });
  }
  return { checkpoints, coverageFailures, drawn, incidents };
}
