import { createDagOutputScratch, parseDagOutput } from './uniforms.ts';

/**
 * What a light cut reports to the host: the pages its views asked for — the lower residency tier
 * (`../../webgpu/residency/shadowTier.ts`) —, copied once a frame and read back after submission
 * (its drops: `lightCutDrops.ts`). One copy is read at a time; a frame that finds it still being read
 * copies nothing, and the next one reports.
 *
 * A report changes the world only once taken: its casters load, a page enters residency, and the
 * shadow pages over it go stale. A barrier that must leave nothing behind waits for all three
 * steps — the copy read (`settled`, `unsettled`), then the report taken (`takeOffered`).
 */
export function createLightCutReports(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  output: GPUBuffer,
  outputBytes: number,
) {
  const readback = own({
    size: outputBytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const scratch = createDagOutputScratch();
  let mapped = false,
    offered = false,
    reading = Promise.resolve(),
    requests: readonly number[] | null = null;
  return {
    /**
     * Copies the frame's requests for the host, unless the previous copy is still being read.
     * Returns the settlement to call once the command buffer is submitted, or dropped.
     */
    encodeReadback(encoder: GPUCommandEncoder) {
      if (mapped) return undefined;
      mapped = true;
      encoder.copyBufferToBuffer(output, 0, readback, 0, outputBytes);
      return (submitted: boolean) => {
        if (!submitted) {
          mapped = false;
          return;
        }
        reading = readback
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const bytes = readback.getMappedRange();
            const parsed = parseDagOutput(bytes, 0, bytes.byteLength, 0, scratch);
            requests = parsed ? parsed.pageIds.slice() : null;
            readback.unmap();
          })
          .catch(() => {})
          .finally(() => {
            mapped = false;
          });
      };
    },
    /** The pages the last read frame's light cut asked for, highest priority first. */
    takeRequests() {
      const taken = requests;
      requests = null;
      offered ||= taken !== null;
      return taken;
    },
    /** Resolves once the copy being read is delivered. */
    settled: () => reading,
    /** A copy on its way, or read and not yet taken. */
    get unsettled() {
      return mapped || requests !== null;
    },
    /** Whether a report was taken since the last call: its casters may still be loading. */
    takeOffered() {
      const taken = offered;
      offered = false;
      return taken;
    },
  };
}
