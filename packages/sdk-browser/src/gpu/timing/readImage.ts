import { summarizeTimestamps, type TimingEntry } from './sample.ts'
import type { createSlotMemory } from './slotMemory.ts'
import type { createTimeline } from './timeline.ts'

/** Maps the timestamps an image wrote and summarises them. Nothing when the timing was disposed
 *  while the mapping was pending. The caller unmaps `staging`. */
export async function readImageTimestamps(
  staging: GPUBuffer,
  used: number,
  entries: TimingEntry[],
  truncated: boolean,
  frame: number,
  slots: ReturnType<typeof createSlotMemory>,
  timeline: ReturnType<typeof createTimeline>,
  isDisposed: () => boolean,
) {
  // Only the timestamps the image wrote are mapped.
  await staging.mapAsync(GPUMapMode.READ, 0, used)
  if (isDisposed()) return undefined
  const values = new BigUint64Array(staging.getMappedRange(0, used))
  const { sample, span } = summarizeTimestamps(entries, values, truncated, slots.read(frame))
  return { sample, idleBetweenMs: timeline.read(frame, span) }
}
