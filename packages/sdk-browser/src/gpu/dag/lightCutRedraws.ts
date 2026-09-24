import { WORK_DROPPED, WORK_ESCALATED } from './shader/viewsWgsl.ts';
import { OUT_FLAGS } from './layout.ts';

/** Frames whose flag word may be in flight at once: a readback maps a frame or two later. */
const SLOTS = 8;

/**
 * WHICH PAGES A LIGHT CUT DREW SHORT, TO BE DRAWN AGAIN. Every frame that runs a cut copies its
 * flag word with the frame's pages, and two bits send those pages back:
 *
 * - **Dropped work** (`WORK_DROPPED`): the views together kept more than the catalogue, and the
 *   pages miss casters. They are drawn again at once, and the pages a frame may draw halve after
 *   a drop and double back after each clean frame. A single view never fills the lists, so the
 *   halving ends.
 * - **Escalation** (`WORK_ESCALATED`): a view drew a placement coarser than it wanted, a cluster
 *   of it not resident — and every page of that view with it, not only the pages over the
 *   missing cluster, which alone a residency change stales. Those pages wait for residency to
 *   change, then are drawn again; a missing cluster that never comes costs no redraw.
 *
 * A frame no slot is free for is drawn again: nobody reads its flag. Without this, what a still
 * image shows would depend on the order its pages were drawn in. `SLOTS` words of readback.
 */
export function createLightCutRedraws(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  output: GPUBuffer,
  pageCap: number,
) {
  const slots = Array.from({ length: SLOTS }, () => ({
    buffer: own({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    busy: false,
    pages: new Int32Array(pageCap),
    count: 0,
    epoch: 0,
  }));
  const redraw = new Set<number>(),
    waiting = new Set<number>();
  let limit = pageCap,
    epoch = 0,
    reading: Promise<unknown> = Promise.resolve();
  const add = (into: Set<number>, pages: ArrayLike<number>, count: number) => {
    for (let i = 0; i < count; i++) into.add(pages[i]);
  };
  const read = (slot: (typeof slots)[number], flags: number) => {
    const dropped = (flags & WORK_DROPPED) !== 0;
    // Residency moved since the frame was encoded: what it lacked may be there now.
    if (dropped || (flags & WORK_ESCALATED && slot.epoch !== epoch))
      add(redraw, slot.pages, slot.count);
    else if (flags & WORK_ESCALATED) add(waiting, slot.pages, slot.count);
    limit = dropped ? Math.max(1, Math.floor(slot.count / 2)) : Math.min(pageCap, limit * 2);
  };
  return {
    /** Copies this frame's flag word with its `count` drawn `pages`; returns the settlement to
     *  call once the command buffer is submitted, or dropped. */
    encode(encoder: GPUCommandEncoder, pages: ArrayLike<number>, count: number) {
      if (!count) return undefined;
      const slot = slots.find(({ busy }) => !busy);
      if (!slot) {
        add(redraw, pages, count);
        return undefined;
      }
      slot.busy = true;
      slot.count = count;
      slot.epoch = epoch;
      for (let i = 0; i < count; i++) slot.pages[i] = pages[i];
      encoder.copyBufferToBuffer(output, OUT_FLAGS * 4, slot.buffer, 0, 4);
      return (submitted: boolean) => {
        if (!submitted) {
          slot.busy = false;
          return;
        }
        const mapped = slot.buffer
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const flags = new Uint32Array(slot.buffer.getMappedRange())[0];
            slot.buffer.unmap();
            read(slot, flags);
          })
          .catch(() => {})
          .finally(() => {
            slot.busy = false;
          });
        reading = Promise.all([reading, mapped]);
      };
    },
    /** Residency the light cuts see changed: the pages that waited on it are drawn again. */
    residencyChanged() {
      epoch++;
      for (const page of waiting) redraw.add(page);
      waiting.clear();
    },
    /** Pages a frame may draw: `pageCap`, halved after a drop. */
    get pageLimit() {
      return limit;
    },
    /** Hands every page to draw again to `visit`, then forgets them; returns how many. */
    takeRedraw(visit: (page: number) => void) {
      const count = redraw.size;
      for (const page of redraw) visit(page);
      redraw.clear();
      return count;
    },
    /** Resolves once every flag copied so far is read. */
    settled: () => reading,
    /** A flag on its way, or pages to draw again not yet taken. */
    get unsettled() {
      return redraw.size > 0 || slots.some(({ busy }) => busy);
    },
  };
}
