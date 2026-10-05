import { fixture } from '../../../../../tests/kit/gpu/timingDevice.ts';
import { createGpuTiming } from './timing.ts';

/** A millisecond, in the nanoseconds the device's timestamps count. */
export const MS = 1_000_000n;

/** A timer on the fixture device; `image(frame, passes)` encodes one image whose passes the
 *  device timed at `passes` (ms pairs) and submits it, its readback not yet landed. */
export function timer(sampleEveryFrames = 1) {
  const f = fixture(),
    samples: any[] = [];
  const timing = createGpuTiming(f.device, {
    sampleEveryFrames,
    onSample: (sample) => void samples.push(sample),
  });
  const image = (frame: number, passes: [number, number][]) => {
    const encoder = timing.createEncoder(frame);
    for (const _ of passes) encoder.beginComputePass({ label: 'pass' }).end();
    encoder.finish();
    const sampled = timing.isSampled(encoder);
    // Its readback: the first (`buffers[1]`, after the resolve buffer) when none is in flight,
    // the second beside one in flight.
    const read = new BigUint64Array(f.buffers[1 + timing.stats().pending]?.getMappedRange() ?? 8);
    passes.forEach(([begin, end], i) => read.set([BigInt(begin) * MS, BigInt(end) * MS], i * 2));
    timing.submitted(encoder, { frame });
    return sampled;
  };
  return { f, timing, samples, image };
}
