import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuTiming, type GpuTimingSample } from './timing.ts'

/** A millisecond, in the nanoseconds the device's timestamps count. */
export const MS = 1_000_000n

/** The kit's device with timestamp queries, as a timer is measured on (`supported`); without them
 *  when not. */
export const timedDevice = (supported = true) =>
  fakeDevice({ features: supported ? ['timestamp-query'] : [] })

/** A timer on the timed device; `image(frame, passes)` encodes one image whose passes the
 *  device timed at `passes` (ms pairs) and submits it, its readback not yet landed. */
export function timer(sampleEveryFrames = 1) {
  const f = timedDevice(),
    samples: GpuTimingSample[] = []
  const timing = createGpuTiming(f.device, {
    sampleEveryFrames,
    onSample: (sample) => void samples.push(sample),
  })
  const image = (frame: number, passes: [number, number][]) => {
    const encoder = timing.createEncoder(frame)
    for (const _ of passes) encoder.beginComputePass({ label: 'pass' }).end()
    encoder.finish()
    const sampled = timing.isSampled(encoder)
    // Its readback: the buffer its last part's timestamps were copied into, as the ring gave it.
    const target = sampled ? f.copies.at(-1)?.to : undefined
    const read = new BigUint64Array(target?.getMappedRange() ?? new ArrayBuffer(8))
    passes.forEach(([begin, end], i) => read.set([BigInt(begin) * MS, BigInt(end) * MS], i * 2))
    timing.submitted(encoder, { frame })
    return sampled
  }
  return { f, timing, samples, image }
}
