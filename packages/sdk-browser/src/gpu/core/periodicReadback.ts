/**
 * Frames between two samples. A sample is a diagnostic: frames in between copy nothing and map
 * nothing, and none ever waits for a sample to return.
 */
const READ_EVERY_IMAGES = 15;

/** `GPUMapMode.READ`, or its value where a test device leaves the enum empty. */
const mapRead = () => (globalThis as { GPUMapMode?: { READ: number } }).GPUMapMode?.READ ?? 1;

/**
 * Periodic sample of counters the GPU wrote, one frame in fifteen. The caller samples a frame,
 * encodes the copy of what it wrote, then signals submission: mapping is requested only after,
 * otherwise that submission would carry a mapped buffer. One sample is in flight at a time, and
 * `read` receives the mapped range, to be read in place before it is unmapped.
 *
 * A device loss or a dispose cancels the mapping: counters keep their last frame, nothing is
 * inferred. The sample buffer is the caller's, created with its own label.
 */
export function createGpuPeriodicReadback(read: (mapped: ArrayBuffer) => void) {
  let buffer: GPUBuffer | undefined,
    bytes = 0,
    ready = false,
    copyEncoded = false,
    mapping = false,
    disposed = false,
    lastSampledFrame = -READ_EVERY_IMAGES;

  // Mapping callbacks, made once: a sampled frame allocates no closure.
  const onMapped = () => {
    if (disposed || !buffer) return;
    read(buffer.getMappedRange(0, bytes));
    ready = true;
  };
  const onMapFailed = () => {};
  const onSettled = () => {
    try {
      buffer?.unmap();
    } catch {
      /* Already unmapped by a dispose. */
    }
    mapping = false;
  };

  return {
    get buffer() {
      return buffer;
    },
    /** True once a sample has returned, until dispose. */
    get ready() {
      return ready;
    },
    /** Adopts the `COPY_DST | MAP_READ` buffer the copies fill; dispose destroys it. */
    adopt(target: GPUBuffer) {
      buffer = target;
    },
    /** True when the interval has elapsed and no sample is still in flight. */
    due(frame: number) {
      return !mapping && !copyEncoded && frame - lastSampledFrame >= READ_EVERY_IMAGES;
    },
    /** Notes the sampled frame: the interval runs from it. */
    sampled(frame: number) {
      lastSampledFrame = frame;
    },
    /** True while frame `frame`'s sample is encoded and not yet submitted: its copies join it. */
    open(frame: number) {
      return copyEncoded && frame === lastSampledFrame;
    },
    /** Encodes the copy of `size` bytes from `source`, to be mapped once the frame is submitted.
     *  The copies of one sampled frame follow each other in the sample. */
    copy(encoder: GPUCommandEncoder, source: GPUBuffer, offset: number, size: number) {
      if (!buffer) return;
      const at = copyEncoded ? bytes : 0;
      encoder.copyBufferToBuffer(source, offset, buffer, at, size);
      bytes = at + size;
      copyEncoded = true;
    },
    /** Requests mapping of the encoded copy. No effect on a frame that encoded none. */
    submitted() {
      if (!copyEncoded || !buffer || disposed) return;
      copyEncoded = false;
      mapping = true;
      Promise.resolve(buffer.mapAsync(mapRead(), 0, bytes))
        .then(onMapped, onMapFailed)
        .finally(onSettled);
    },
    dispose() {
      disposed = true;
      ready = false;
      copyEncoded = false;
      buffer?.destroy();
      buffer = undefined;
    },
  };
}
