import { createGpuPeriodicReadback } from './gpuPeriodicReadback.ts';
import { HIZ_BOUNDS_VALUES, createHizCounts, hizOversizedFlat, type HizCounts } from './hiz.ts';

/** One image's counts and the number of that image. */
export type HizCountsFrame = HizCounts & { frame: number };

/**
 * Per-image inputs the counters need and the test does not: the triangles each tested box carries, in
 * the order the boxes are handed over, and the image those boxes belong to. One object, reused by the
 * caller from image to image, so counting allocates nothing per image.
 */
export type HizCountSample = { triangles: ArrayLike<number>; frame: number };

/**
 * Counting machinery for the GPU occlusion test, sized once. The verdicts are written by the GPU, so
 * counting what they eliminated costs one copy of the flag rows and one mapping, both on the periodic
 * readback's rhythm. `counted` describes the last image whose verdicts came back; the `sampled*`
 * fields hold the image being read, because the caller's own arrays are rewritten by the next one.
 * Nothing here is deduced: a device that cannot map a buffer simply never reports counts.
 */
export function createHizCounters(cap: number) {
  const counted: HizCountsFrame = { ...createHizCounts(), frame: -1 };
  const sampledRows = new Uint32Array(cap),
    sampledTriangles = new Uint32Array(cap);
  let sampledCount = 0,
    sampledFrame = -1,
    sampledTested = 0,
    sampledOversized = 0,
    sampledTestedTriangles = 0,
    sampledOversizedTriangles = 0;

  const reader = createGpuPeriodicReadback((mapped) => {
    const verdicts = new Uint32Array(mapped),
      rowsRead = verdicts.length;
    let rejected = 0,
      rejectedTriangles = 0;
    for (let i = 0; i < sampledCount; i++) {
      const row = sampledRows[i];
      if (row < rowsRead && verdicts[row]) {
        rejected++;
        rejectedTriangles += sampledTriangles[i];
      }
    }
    counted.frame = sampledFrame;
    counted.tested = sampledTested;
    counted.oversized = sampledOversized;
    counted.testedTriangles = sampledTestedTriangles;
    counted.oversizedTriangles = sampledOversizedTriangles;
    counted.rejected = rejected;
    counted.rejectedTriangles = rejectedTriangles;
  });

  /** Staging buffer for the verdicts, made on the first sampled image and never once per image. */
  const ensureReadback = (target: GPUDevice) => {
    if (reader.buffer) return true;
    if (typeof target.createBuffer !== 'function') return false;
    try {
      const buffer = target.createBuffer({
        label: 'WG HiZ counts readback',
        size: Math.max(4, cap * 4),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      if (typeof buffer.mapAsync !== 'function' || typeof buffer.getMappedRange !== 'function') {
        buffer.destroy();
        return false;
      }
      reader.adopt(buffer);
      return true;
    } catch {
      return false;
    }
  };

  return {
    /** True when this image owes a readback: the interval elapsed and no mapping is in flight. */
    due(device: GPUDevice, sample: HizCountSample | undefined, flagRows: number) {
      return !!sample && flagRows > 0 && reader.due(sample.frame) && ensureReadback(device);
    },
    /** Records one tested box while the caller packs it, so counting walks the boxes only once. */
    observe(index: number, row: number, triangles: number, bounds: Float64Array) {
      sampledRows[index] = row;
      sampledTriangles[index] = triangles;
      sampledTested++;
      sampledTestedTriangles += triangles;
      if (hizOversizedFlat(bounds, index * HIZ_BOUNDS_VALUES)) {
        sampledOversized++;
        sampledOversizedTriangles += triangles;
      }
    },
    /** Clears the running totals before a sampled image records its boxes. */
    beginSample() {
      sampledTested = 0;
      sampledOversized = 0;
      sampledTestedTriangles = 0;
      sampledOversizedTriangles = 0;
    },
    /** Encodes the copy of the verdicts this image will read back. */
    encodeCopy(
      encoder: GPUCommandEncoder,
      flags: GPUBuffer,
      count: number,
      flagRows: number,
      frame: number,
    ) {
      if (!reader.buffer) return;
      sampledCount = count;
      sampledFrame = frame;
      reader.copy(encoder, flags, 0, Math.min(cap, flagRows) * 4);
      reader.sampled(frame);
    },
    /**
     * Hands the verdicts of the sampled image to the mapping, once the image that encoded the copy
     * has been submitted. A no-op on every image that encoded no copy.
     */
    submitted: reader.submitted,
    /**
     * Counts of the last image whose verdicts came back, and the number of that image. Undefined
     * until one has.
     */
    counts() {
      return reader.ready ? counted : undefined;
    },
    dispose: reader.dispose,
  };
}
