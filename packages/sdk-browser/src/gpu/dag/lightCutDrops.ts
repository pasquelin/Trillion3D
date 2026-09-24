import { WORK_DROPPED } from './shader/viewsWgsl.ts';
import { OUT_FLAGS } from './layout.ts';

/** Frames whose drop flag may be in flight at once: a readback maps a frame or two later. */
const SLOTS = 8;

/**
 * WHICH PAGES A LIGHT CUT DREW WITHOUT ALL THEIR CASTERS. The views of one cut share the camera
 * cut's lists; when together they keep more than the catalogue, work is dropped (`WORK_DROPPED`)
 * and the pages drawn that frame miss casters. Every frame that runs a cut copies its flag word
 * with the frame's pages; a flag that comes back set hands those pages back to be drawn again —
 * as does a frame no slot was free for, whose flag nobody reads.
 *
 * Drawn again in the same number, they would drop again: the pages a frame may draw halve after a
 * drop and double back after each clean frame. A single view never fills the lists, so the halving
 * ends. Allocated with the light cut, `SLOTS` words of readback.
 */
export function createLightCutDrops(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  output: GPUBuffer,
  pageCap: number,
) {
  const slots = Array.from({ length: SLOTS }, () => ({
    buffer: own({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    busy: false,
    pages: new Int32Array(pageCap),
    count: 0,
  }));
  const redraw = new Int32Array(pageCap * (SLOTS + 1));
  let redrawCount = 0,
    limit = pageCap,
    reading: Promise<unknown> = Promise.resolve();
  const handBack = (pages: ArrayLike<number>, count: number) => {
    for (let i = 0; i < count && redrawCount < redraw.length; i++) redraw[redrawCount++] = pages[i];
  };
  return {
    /** Copies this frame's flag word with its `count` drawn `pages`; returns the settlement to
     *  call once the command buffer is submitted, or dropped. */
    encode(encoder: GPUCommandEncoder, pages: ArrayLike<number>, count: number) {
      if (!count) return undefined;
      const slot = slots.find(({ busy }) => !busy);
      if (!slot) {
        handBack(pages, count);
        return undefined;
      }
      slot.busy = true;
      slot.count = count;
      for (let i = 0; i < count; i++) slot.pages[i] = pages[i];
      encoder.copyBufferToBuffer(output, OUT_FLAGS * 4, slot.buffer, 0, 4);
      return (submitted: boolean) => {
        if (!submitted) {
          slot.busy = false;
          return;
        }
        const read = slot.buffer
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const dropped = (new Uint32Array(slot.buffer.getMappedRange())[0] & WORK_DROPPED) !== 0;
            slot.buffer.unmap();
            if (dropped) handBack(slot.pages, slot.count);
            limit = dropped
              ? Math.max(1, Math.floor(slot.count / 2))
              : Math.min(pageCap, limit * 2);
          })
          .catch(() => {})
          .finally(() => {
            slot.busy = false;
          });
        reading = Promise.all([reading, read]);
      };
    },
    /** Pages a frame may draw: `pageCap`, halved after a drop. */
    get pageLimit() {
      return limit;
    },
    /** Hands every page to draw again to `visit`, then forgets them; returns how many. */
    takeRedraw(visit: (page: number) => void) {
      const count = redrawCount;
      for (let i = 0; i < count; i++) visit(redraw[i]);
      redrawCount = 0;
      return count;
    },
    /** Resolves once every flag copied so far is read. */
    settled: () => reading,
    /** A flag on its way, or pages handed back and not yet taken. */
    get unsettled() {
      return redrawCount > 0 || slots.some(({ busy }) => busy);
    },
  };
}
