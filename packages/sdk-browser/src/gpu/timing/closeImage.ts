import { failedSample, timingEntries, type TimingEntry } from './sample.ts';
import { readImageTimestamps } from './readImage.ts';
import type { TimingState } from './timingState.ts';

/** Closes the image: `encoder` is its last submission, and every part resolved so far is read. */
export function closeTimedImage(
  state: TimingState,
  encoder: GPUCommandEncoder,
  metadata: Record<string, unknown>,
) {
  const image = state.active;
  if (!image || !image.parts.has(encoder)) return;
  state.active = undefined;
  const collected = timingEntries(image.parts.values(), image.truncated);
  const { entries, truncated } = collected;
  state.tally.unresolvedParts += collected.unresolvedParts;
  if (!entries.length || !state.resources) return;
  const staging = image.read,
    used = image.cursor * 8;
  const readback = readImage(
    state,
    staging,
    used,
    entries,
    truncated,
    image.frame,
    metadata,
  ).finally(() => {
    state.inFlight.delete(staging);
  });
  state.inFlight.set(staging, readback);
}

/** Reads one image's timestamps and emits its sample; a failure disables the timing and emits the
 *  failed sample instead, unless the timing was disposed meanwhile. Always unmaps `staging`. */
async function readImage(
  state: TimingState,
  staging: GPUBuffer,
  used: number,
  entries: TimingEntry[],
  truncated: boolean,
  frame: number,
  metadata: Record<string, unknown>,
) {
  try {
    const read = await readImageTimestamps(
      staging,
      used,
      entries,
      truncated,
      frame,
      state.slots,
      state.timeline,
      () => state.disposed,
    );
    if (!read) return;
    const { sample, idleBetweenMs } = read;
    state.tally.invalidSamples += sample.pairs.invalid;
    state.emit({ ...metadata, frame, ...sample, idleBetweenMs });
    state.tally.completedSamples++;
  } catch (error) {
    if (!state.disposed) {
      state.enabled = false;
      state.emit({ ...metadata, ...failedSample(frame, truncated, String(error)) });
      state.tally.completedSamples++;
    }
  } finally {
    try {
      staging.unmap();
    } catch {
      /* Disposal or device loss can cancel a mapping. */
    }
  }
}
