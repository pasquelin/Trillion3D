// The frames of a parity path: the images played in order, the camera and the clip posed ahead of
// each, with a capture taken straight after each image the path asks for.
import { runFrames, type BenchClock, type FrameRecord, type FrameRig } from '../capture/frames.ts'
import type { ParityTrack } from './parityScenario.ts'

/** Plays all of `track`'s images, `pose(i)` ahead of image `i`; after each image of `track.shots`,
 *  `shoot(i)` runs, between two frames and in none's window. Resolves to the frames and the shots.
 *  `play` draws the frames of one stretch (`runFrames`). */
export async function runTrack<Shot>(
  rig: FrameRig,
  clock: BenchClock,
  track: ParityTrack,
  pose: (i: number) => void,
  shoot: (i: number) => Promise<Shot>,
  play: typeof runFrames = runFrames,
) {
  const frames: FrameRecord[] = []
  const shots: Shot[] = []
  const last = track.rows.length - 1
  const wanted = new Set(track.shots)
  const stops = [...new Set([...wanted, last])].sort((a, b) => a - b)
  let from = 0
  for (const stop of stops) {
    frames.push(...(await play(rig, clock, stop - from + 1, (i) => pose(from + i))))
    if (wanted.has(stop)) shots.push(await shoot(stop))
    from = stop + 1
  }
  return { frames, shots }
}
