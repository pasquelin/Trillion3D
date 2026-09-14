import { HIZ_BOUNDS_VALUES, createHizCounts, hizOversizedFlat, type HizCounts } from './hiz.ts';

/**
 * Images between two readbacks of the test verdicts. The verdicts are written by the GPU, so counting
 * what they eliminated costs one copy of the flag rows and one mapping; both are kept off the images
 * in between, and neither ever blocks an image.
 */
const COUNT_EVERY_IMAGES = 15;

/**
 * Per-image inputs the counters need and the test does not: the triangles each tested box carries, in
 * the order the boxes are handed over, and the image those boxes belong to. One object, reused by the
 * caller from image to image, so counting allocates nothing per image.
 */
export type HizCountSample = { triangles: ArrayLike<number>; frame: number };

/** `GPUMapMode.READ`, or the value it holds where a stub device leaves the enum undefined. */
const mapRead = () => (globalThis as { GPUMapMode?: { READ: number } }).GPUMapMode?.READ ?? 1;

/**
 * Counting machinery for the GPU occlusion test, sized once. `counted` describes the last image whose
 * verdicts came back; the `sampled*` fields hold the image being read, because the caller's own arrays
 * are rewritten by the next one. Nothing here is deduced: a device that cannot map a buffer simply
 * never reports counts.
 */
export function createHizCounters(cap: number) {
  const counted = createHizCounts() as HizCounts & { frame: number };
  counted.frame = -1;
  let countedReady = false;
  const sampledRows = new Uint32Array(cap),
    sampledTriangles = new Uint32Array(cap);
  let sampledCount = 0,
    sampledFrame = -1,
    sampledTested = 0,
    sampledOversized = 0,
    sampledTestedTriangles = 0,
    sampledOversizedTriangles = 0;
  let readback: GPUBuffer | undefined,
    readbackRows = 0,
    copyEncoded = false,
    mapping = false,
    lastCountedFrame = -COUNT_EVERY_IMAGES;
  let disposed = false;

  /** Staging buffer for the verdicts, made on the first sampled image and never once per image. */
  const ensureReadback = (target: GPUDevice) => {
    if (readback) return true;
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
      readback = buffer;
      return true;
    } catch {
      return false;
    }
  };

  return {
    /** True when this image owes a readback: the interval elapsed and no mapping is in flight. */
    due(device: GPUDevice, sample: HizCountSample | undefined, flagRows: number) {
      return (
        !!sample &&
        !mapping &&
        !copyEncoded &&
        flagRows > 0 &&
        sample.frame - lastCountedFrame >= COUNT_EVERY_IMAGES &&
        ensureReadback(device)
      );
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
      if (!readback) return;
      sampledCount = count;
      sampledFrame = frame;
      readbackRows = Math.min(cap, flagRows);
      encoder.copyBufferToBuffer(flags, 0, readback, 0, readbackRows * 4);
      copyEncoded = true;
      lastCountedFrame = frame;
    },
    /**
     * Hands the verdicts of the sampled image to the mapping. Called once the image that encoded the
     * copy has been submitted: a mapping requested before the submission would make that submission
     * use a mapped buffer. A no-op on every image that encoded no copy.
     */
    submitted() {
      const buffer = readback;
      if (!copyEncoded || !buffer || disposed) return;
      copyEncoded = false;
      mapping = true;
      const rowsRead = readbackRows;
      Promise.resolve(buffer.mapAsync(mapRead(), 0, rowsRead * 4))
        .then(() => {
          if (disposed) return;
          const verdicts = new Uint32Array(buffer.getMappedRange(0, rowsRead * 4));
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
          countedReady = true;
        })
        .catch(() => {
          /* A device loss or a disposal cancels a mapping; the counters keep their last image. */
        })
        .finally(() => {
          try {
            buffer.unmap();
          } catch {
            /* Already unmapped by a disposal. */
          }
          mapping = false;
        });
    },
    /**
     * Counts of the last image whose verdicts came back, and the number of that image. Undefined
     * until one has.
     */
    counts() {
      return countedReady ? counted : undefined;
    },
    dispose() {
      disposed = true;
      countedReady = false;
      copyEncoded = false;
      readback?.destroy();
      readback = undefined;
    },
  };
}
