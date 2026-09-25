import { MAX_SHADOW_PAGES as PAGES } from '../shadow/recordPack.ts';
import { COARSER_VIEWS, WORK_DROPPED } from './shader/viewsWgsl.ts';
import { OUT_FLAGS } from './layout.ts';

/**
 * WHICH PAGES A LIGHT CUT DREW SHORT, TO BE DRAWN AGAIN. Every frame that runs a cut copies its
 * flag word with the frame's pages, and two bits send those pages back:
 *
 * - **Dropped work** (`WORK_DROPPED`): the views together kept more than the catalogue, and the
 *   pages miss casters. They are drawn again at once, and the views one batch draws in are
 *   bisected between the most a batch drew whole and the fewest one dropped with
 *   (`createViewLimit`). A single view never fills the lists, so the bisection ends at one view at
 *   worst. It bounds a batch, never a frame: a frame draws as many batches as its pages take
 *   (`../../webgpu/pages/render/encodeShadowBatches.ts`).
 * - **Coarser** (`COARSER_VIEWS`, one bit per view): a view wanted a cluster that is not resident
 *   and drew its nearest resident ancestor — and every page of that view is sent back, not only the
 *   pages over the missing cluster, which alone a residency change stales. Those pages, and only
 *   those of the views that drew coarser, wait for residency to change and the camera to rest, then
 *   are drawn again: like any change of representation (`changes.ts`), a camera that only moves
 *   redraws no page whose casters and light stayed where they were.
 *
 * Every batch copies its flag word into a slot of its own: a frame draws as many batches as its
 * pages take, and a readback maps a frame or two later, so a batch that finds every slot busy adds
 * one — never a page drawn again because nobody would read its flag. Without the flag, what a
 * still image shows would depend on the order its pages were drawn in. Four bytes of readback a
 * slot, as many slots as batches were ever in flight at once.
 */
export function createLightCutRedraws(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  output: GPUBuffer,
  viewCap: number,
) {
  const makeSlot = () => ({
    buffer: own({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    busy: false,
    pages: new Int32Array(PAGES),
    /** The view of each page, the rank its run has in the batch's cut. */
    views: new Uint8Array(PAGES),
    count: 0,
    epoch: 0,
    reported: true,
    reading: Promise.resolve(),
  });
  const slots: ReturnType<typeof makeSlot>[] = [];
  /** Each page to draw again, and whether its depth is wrong — dropped work — and is withdrawn
   *  meanwhile, or only coarser — a missing cluster — and stays read. */
  const redraw = new Map<number, boolean>(),
    waiting = new Set<number>();
  const limit = createViewLimit(viewCap);
  let epoch = 0,
    /** Residency changed since the waiting pages were last released. */
    moved = false;
  const again = (page: number, withdraw: boolean) =>
    redraw.set(page, withdraw || !!redraw.get(page));
  const add = (pages: ArrayLike<number>, count: number) => {
    for (let i = 0; i < count; i++) again(pages[i], true);
  };
  const read = (slot: (typeof slots)[number], flags: number) => {
    const dropped = (flags & WORK_DROPPED) !== 0;
    let views = 0;
    for (let i = 0; i < slot.count; i++) views = Math.max(views, slot.views[i] + 1);
    limit.read(views, dropped);
    if (dropped) return add(slot.pages, slot.count);
    // Residency moved since the frame was encoded: what it lacked may be there now. A frame whose
    // requests were not copied waits for nothing: what it lacked was never asked for.
    const now = slot.epoch !== epoch || !slot.reported,
      coarser = flags >>> COARSER_VIEWS;
    for (let i = 0; i < slot.count; i++)
      if ((coarser >>> slot.views[i]) & 1)
        if (now) again(slot.pages[i], false);
        else waiting.add(slot.pages[i]);
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
      let slot = slots.find(({ busy }) => !busy);
      if (!slot) slots.push((slot = makeSlot()));
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
    /** Residency the light cuts see changed: the drop is forgotten, and the pages that waited on
     *  it are drawn again once the camera rests (`rest`). */
    residencyChanged() {
      moved = true;
      limit.residencyChanged();
    },
    /** The camera rests: what residency changed meanwhile is drawn again. */
    rest() {
      if (!moved) return;
      moved = false;
      epoch++;
      for (const page of waiting) again(page, false);
      waiting.clear();
    },
    /** Light views one batch draws in: `viewCap` until a batch drops (`createViewLimit`). */
    get viewLimit() {
      return limit.value;
    },
    /** Hands every page to draw again to `visit`, and whether it is withdrawn until then; forgets
     *  them; returns how many. */
    takeRedraw(visit: (page: number, withdraw: boolean) => void) {
      const count = redraw.size;
      for (const [page, withdraw] of redraw) visit(page, withdraw);
      redraw.clear();
      return count;
    },
    /** Resolves once every flag copied so far is read. */
    settled: () => Promise.all(slots.map(({ reading }) => reading)).then(() => {}),
    /** A flag on its way, pages to draw again not yet taken, or a residency change the next rest
     *  releases. */
    get unsettled() {
      return redraw.size > 0 || (moved && waiting.size > 0) || slots.some(({ busy }) => busy);
    },
  };
}

/**
 * The light views one batch draws in, bisected between the most views a batch drew whole and the
 * fewest a batch dropped work with: a drop at `L` views never swings the limit between `L` and
 * `L / 2`, it settles on the largest count that fits, never below one. What dropped depends on the
 * clusters the views kept from the resident catalogue: a residency change forgets the drop, never
 * what fitted.
 */
function createViewLimit(viewCap: number) {
  let fits = 0,
    drops = viewCap + 1;
  return {
    read(count: number, dropped: boolean) {
      if (dropped) {
        drops = Math.min(drops, count);
        fits = Math.min(fits, drops - 1);
      } else {
        fits = Math.max(fits, count);
        if (fits >= drops) drops = viewCap + 1;
      }
    },
    residencyChanged() {
      drops = viewCap + 1;
    },
    get value() {
      return drops > viewCap ? viewCap : Math.max(1, Math.floor((fits + drops) / 2));
    },
  };
}
