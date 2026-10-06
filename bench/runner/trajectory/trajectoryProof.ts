// Image-only trajectory verdicts. A late image is not evidence of a permanent regression.
import type { Capture } from '../../../tests/kit/server/staticServer.ts'
import { imageDiff } from '../references/imageDiff.ts'
import type { ImageDiff } from '../report/types.ts'
import { FRAMES_PER_SEGMENT, PATH_POSES } from './poses.ts'

export interface TrajectoryCheckpoint {
  index: number
  arrival: string | null
  settled: string
  settleFrames: number | null
  pagesRequested: number | null
  residentPages: number | null
}

/** At most this many checkpoints per proof: each holds a full-resolution capture per pass. */
const MAX_CHECKPOINTS = 32

/** Bounds the proof independently of machine speed. Every segment has an image checkpoint. */
export function checkpointIndices(frames: number, interval: number) {
  if (!Number.isInteger(frames) || frames < 1 || frames > PATH_POSES)
    throw new Error(`trajectory frames must be an integer from 1 to ${PATH_POSES}`)
  if (!Number.isInteger(interval) || interval < 1 || interval > FRAMES_PER_SEGMENT)
    throw new Error(`checkpoint interval must be an integer from 1 to ${FRAMES_PER_SEGMENT}`)
  const indices = Array.from({ length: frames }, (_, index) => index).filter(
    (index) => index % interval === 0 || index === frames - 1,
  )
  if (indices.length > MAX_CHECKPOINTS)
    throw new Error(`at most ${MAX_CHECKPOINTS} checkpoints per proof`)
  return indices
}

type Measured = Extract<ImageDiff, { pixels: number }>
const valid = (diff: ImageDiff): diff is Measured => diff !== null && 'pixels' in diff

/** A/A must be exactly zero before a reference capture can serve as a golden. */
export function trajectoryVerdict(
  reference: TrajectoryCheckpoint,
  repeat: TrajectoryCheckpoint,
  candidate: TrajectoryCheckpoint,
  captures: ReadonlyMap<string, Capture>,
) {
  const golden = captures.get(reference.settled)
  const aa = imageDiff(golden, captures.get(repeat.settled))
  const arrival = imageDiff(golden, captures.get(candidate.arrival ?? ''))
  const settled = imageDiff(golden, captures.get(candidate.settled))
  let status: 'match' | 'transient' | 'regression' | 'unstable-reference' | 'unsettled' | 'invalid'
  if (reference.index !== repeat.index || reference.index !== candidate.index) status = 'invalid'
  else if (reference.settleFrames === null || repeat.settleFrames === null)
    status = 'unstable-reference'
  else if (!valid(aa) || !valid(arrival) || !valid(settled)) status = 'invalid'
  else if (aa.pixels !== 0) status = 'unstable-reference'
  else if (candidate.settleFrames === null) status = 'unsettled'
  else if (settled.pixels !== 0) status = 'regression'
  else status = arrival.pixels !== 0 ? 'transient' : 'match'
  return { index: reference.index, status, aa, arrival, settled, candidate }
}
