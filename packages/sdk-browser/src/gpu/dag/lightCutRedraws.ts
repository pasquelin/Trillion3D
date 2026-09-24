import { ESCALATED_VIEWS, WORK_DROPPED } from './shader/viewsWgsl.ts';
import { OUT_FLAGS } from './layout.ts';

/** Frames whose flag word may be in flight at once: a readback maps a frame or two later. */
const SLOTS = 8;

/**
 * WHICH PAGES A LIGHT CUT DREW SHORT, TO BE DRAWN AGAIN. Every frame that runs a cut copies its
 * flag word with the frame's pages, and two bits send those pages back:
 *
 * - **Dropped work** (`WORK_DROPPED`): the views together kept more than the catalogue, and the
 *   pages miss casters. They are drawn again at once, and the pages a frame may draw are bisected
 *   between the most a frame drew whole and the fewest one dropped with (`createPageLimit`). A
 *   single view never fills the lists, so the bisection ends.
 * - **Escalation** (`ESCALATED_VIEWS`, one bit per view): a view drew a placement coarser than it
 *   wanted, a cluster of it not resident — and every page of that view with it, not only the
 *   pages over the missing cluster, which alone a residency change stales. Those pages, and only
 *   those of the views that escalated, wait for residency to change, then are drawn again.
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
    /** The view of each page, the rank its run has in the frame's cut. */
    views: new Uint8Array(pageCap),
    count: 0,
    epoch: 0,
    reported: true,
    reading: Promise.resolve(),
  }));
  const redraw = new Set<number>(),
    waiting = new Set<number>();
  const limit = createPageLimit(pageCap);
  let epoch = 0;
  const add = (into: Set<number>, pages: ArrayLike<number>, count: number) => {
    for (let i = 0; i < count; i++) into.add(pages[i]);
  };
  const read = (slot: (typeof slots)[number], flags: number) => {
    const dropped = (flags & WORK_DROPPED) !== 0;
    limit.read(slot.count, dropped);
    if (dropped) return add(redraw, slot.pages, slot.count);
    // Residency moved since the frame was encoded: what it lacked may be there now. A frame whose
    // requests were not copied waits for nothing: what it lacked was never asked for.
    const into = slot.epoch !== epoch || !slot.reported ? redraw : waiting,
      escalated = flags >>> ESCALATED_VIEWS;
    for (let i = 0; i < slot.count; i++)
      if ((escalated >>> slot.views[i]) & 1) into.add(slot.pages[i]);
  };
  return {
    /** Copies this frame's flag word with its `count` drawn `pages`, drawn in the cut's `views` —
     *  `reported` when the frame's requests were copied too (`lightCutReports.ts`); returns the
     *  settlement to call once the command buffer is submitted, or dropped. */
    encode(
      encoder: GPUCommandEncoder,
      pages: ArrayLike<number>,
      views: ArrayLike<number>,
      count: number,
      reported: boolean,
    ) {
      if (!count) return undefined;
      const slot = slots.find(({ busy }) => !busy);
      if (!slot) {
        add(redraw, pages, count);
        return undefined;
      }
      slot.busy = true;
      slot.count = count;
      slot.epoch = epoch;
      slot.reported = reported;
      for (let i = 0; i < count; i++) {
        slot.pages[i] = pages[i];
        slot.views[i] = views[i];
      }
      encoder.copyBufferToBuffer(output, OUT_FLAGS * 4, slot.buffer, 0, 4);
      return (submitted: boolean) => {
        if (!submitted) {
          slot.busy = false;
          return;
        }
        slot.reading = slot.buffer
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
      };
    },
    /** Residency the light cuts see changed: the pages that waited on it are drawn again. */
    residencyChanged() {
      epoch++;
      limit.residencyChanged();
      for (const page of waiting) redraw.add(page);
      waiting.clear();
    },
    /** Pages a frame may draw: `pageCap` until a frame drops (`createPageLimit`). */
    get pageLimit() {
      return limit.value;
    },
    /** Hands every page to draw again to `visit`, then forgets them; returns how many. */
    takeRedraw(visit: (page: number) => void) {
      const count = redraw.size;
      for (const page of redraw) visit(page);
      redraw.clear();
      return count;
    },
    /** Resolves once every flag copied so far is read. */
    settled: () => Promise.all(slots.map(({ reading }) => reading)).then(() => {}),
    /** A flag on its way, or pages to draw again not yet taken. */
    get unsettled() {
      return redraw.size > 0 || slots.some(({ busy }) => busy);
    },
  };
}

/**
 * The pages a frame may draw, bisected between the most pages a frame drew whole and the fewest a
 * frame dropped work with: a drop at `L` pages never swings the limit between `L` and `L / 2`, it
 * settles on the largest count that fits. What dropped depends on the clusters the views kept from
 * the resident catalogue: a residency change forgets the drop, never what fitted.
 */
function createPageLimit(pageCap: number) {
  let fits = 0,
    drops = pageCap + 1;
  return {
    read(count: number, dropped: boolean) {
      if (dropped) {
        drops = Math.min(drops, count);
        fits = Math.min(fits, drops - 1);
      } else {
        fits = Math.max(fits, count);
        if (fits >= drops) drops = pageCap + 1;
      }
    },
    residencyChanged() {
      drops = pageCap + 1;
    },
    get value() {
      return drops > pageCap ? pageCap : Math.max(1, Math.floor((fits + drops) / 2));
    },
  };
}
