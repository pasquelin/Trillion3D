import { OUT_COUNT, SELECTION_HEADER_WORDS } from './layout.ts';
import { requestPage } from './request.ts';

/**
 * Copies of the report in flight at once: one being mapped while the next frame copies. A frame
 * copies one report, after its last batch: every batch's cut appends its requests to the same list
 * (`VIEW_APPEND`, `shader/pagesWgsl.ts`), so one copy reads them all, whatever the batch count. A
 * frame that finds both still being read copies nothing, and says so (`encodeReadback`): the pages it drew
 * coarse are then drawn again rather than left waiting on requests nobody will read
 * (`lightCutRedraws.ts`).
 */
const SLOTS = 2;

/**
 * What a light cut reports to the host: the pages its views asked for — the lower residency tier
 * (`../../webgpu/residency/lowerTier.ts`) —, copied once a frame and read back after submission
 * (its short draws: `lightCutRedraws.ts`). Every copy read before a take joins the next take: two
 * reads between two takes lose neither.
 *
 * The requests come out highest priority first, then highest page first at equal priority: the
 * order the GPU appended them in is its atomic order, and two captures of one pose must ask for
 * the same casters in the same order.
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
  const slots = Array.from({ length: SLOTS }, () => ({
    buffer: own({ size: outputBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    busy: false,
    reading: Promise.resolve(),
  }));
  const listCap = outputBytes / 4 - SELECTION_HEADER_WORDS;
  /** Request words read and not yet taken: page and priority in one word (`request.ts`). */
  const words: number[] = [];
  let read = false,
    offered = false;
  return {
    /**
     * Copies the frame's requests for the host into a free slot. Returns the settlement to call
     * once the command buffer is submitted, or dropped; undefined when every slot is being read
     * and the frame's requests are not copied.
     */
    encodeReadback(encoder: GPUCommandEncoder) {
      const slot = slots.find(({ busy }) => !busy);
      if (!slot) return undefined;
      slot.busy = true;
      encoder.copyBufferToBuffer(output, 0, slot.buffer, 0, outputBytes);
      return (submitted: boolean) => {
        if (!submitted) {
          slot.busy = false;
          return;
        }
        slot.reading = slot.buffer
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const ints = new Uint32Array(slot.buffer.getMappedRange());
            const count = Math.min(ints[OUT_COUNT] ?? 0, listCap);
            for (let i = 0; i < count; i++) words.push(ints[SELECTION_HEADER_WORDS + i]);
            read = true;
            slot.buffer.unmap();
          })
          .catch(() => {})
          .finally(() => {
            slot.busy = false;
          });
      };
    },
    /** The pages every copy read since the last take asked for, highest priority first; null
     *  when none was read. */
    takeRequests() {
      if (!read) return null;
      read = false;
      offered = true;
      words.sort((a, b) => b - a);
      const pages = words.map(requestPage);
      words.length = 0;
      return pages;
    },
    /** Resolves once every copy on its way is delivered. */
    settled: () => Promise.all(slots.map(({ reading }) => reading)).then(() => {}),
    /** A copy on its way, or read and not yet taken. */
    get unsettled() {
      return read || slots.some(({ busy }) => busy);
    },
    /** Whether a report was taken since the last call: its casters may still be loading. */
    takeOffered() {
      const taken = offered;
      offered = false;
      return taken;
    },
  };
}
