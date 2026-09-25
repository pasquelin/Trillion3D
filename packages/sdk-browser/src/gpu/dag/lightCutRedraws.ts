import { MAX_SHADOW_PAGES as PAGES } from '../shadow/recordPack.ts';
import { MAX_SHADOW_BATCHES as BATCHES, SHADOW_FLAG_FRAMES } from '../shadow/batchBudget.ts';
import { COARSER_VIEWS, LIST_FULL, WORK_DROPPED } from './shader/viewsWgsl.ts';
import { OUT_FLAGS } from './layout.ts';
import { createViewLimit } from './lightCutViewLimit.ts';

/**
 * WHICH PAGES A LIGHT CUT DREW SHORT, TO BE DRAWN AGAIN. Every batch that runs a cut copies its
 * flag word with the batch's pages, and two bits send those pages back:
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
 *   redraws no page whose casters and light stayed where they were. A batch whose requests were
 *   not read — the frame's report not copied, or its list full before the batch's flag — waits
 *   for nothing: what it lacked was never asked for, and its pages are drawn again at once.
 *
 * A frame's flag words ride in one slot: a buffer of a word per batch, and the batches' pages,
 * sized once for the most batches a frame draws (`../shadow/batchBudget.ts`). `SHADOW_FLAG_FRAMES`
 * slots, allocated at creation, hold that many frames in flight; a frame that finds every slot
 * still read — the GPU that far behind — cannot know what its cuts drew short, so its pages are
 * drawn again, withdrawn meanwhile. Without the flag, what a still image shows would depend on the
 * order its pages were drawn in.
 */
export function createLightCutRedraws(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  output: GPUBuffer,
  viewCap: number,
) {
  const slots = Array.from({ length: SHADOW_FLAG_FRAMES }, () => ({
    buffer: own({ size: BATCHES * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    busy: false,
    pages: new Int32Array(BATCHES * PAGES),
    /** The view of each page, the rank its run has in its batch's cut. */
    views: new Uint8Array(BATCHES * PAGES),
    /** Where each batch's pages end. */
    ends: new Uint16Array(BATCHES),
    batches: 0,
    epoch: 0,
    reported: false,
    reading: Promise.resolve(),
  }));
  type Slot = (typeof slots)[number];
  /** The slot of the frame being encoded, until its settlement. */
  let open: Slot | undefined;
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
  const read = (slot: Slot, batch: number, flags: number) => {
    const from = batch ? slot.ends[batch - 1] : 0,
      to = slot.ends[batch];
    const dropped = (flags & WORK_DROPPED) !== 0;
    let views = 0;
    for (let i = from; i < to; i++) views = Math.max(views, slot.views[i] + 1);
    limit.read(views, dropped);
    if (dropped) {
      for (let i = from; i < to; i++) again(slot.pages[i], true);
      return;
    }
    // Residency moved since the frame was encoded: what it lacked may be there now.
    const now = slot.epoch !== epoch || !slot.reported || (flags & LIST_FULL) !== 0,
      coarser = flags >>> COARSER_VIEWS;
    for (let i = from; i < to; i++)
      if ((coarser >>> slot.views[i]) & 1)
        if (now) again(slot.pages[i], false);
        else waiting.add(slot.pages[i]);
  };
  const settle = (slot: Slot) => (submitted: boolean) => {
    if (open === slot) open = undefined;
    if (!submitted) {
      slot.busy = false;
      return;
    }
    slot.reading = slot.buffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const flags = new Uint32Array(slot.buffer.getMappedRange(), 0, slot.batches);
        for (let batch = 0; batch < slot.batches; batch++) read(slot, batch, flags[batch]);
        slot.buffer.unmap();
      })
      .catch(() => {})
      .finally(() => {
        slot.busy = false;
      });
  };
  return {
    /** Copies a batch's flag word with its `count` drawn `pages`, drawn in the cut's `views`. The
     *  frame's first batch returns the settlement to call once the command buffer is submitted,
     *  or dropped; the others ride in its slot. */
    encode(
      encoder: GPUCommandEncoder,
      pages: ArrayLike<number>,
      views: ArrayLike<number>,
      count: number,
    ) {
      if (!count) return undefined;
      let settlement: ((submitted: boolean) => void) | undefined;
      if (!open) {
        const free = slots.find(({ busy }) => !busy);
        if (free) {
          open = free;
          free.busy = true;
          free.batches = 0;
          free.epoch = epoch;
          free.reported = false;
          settlement = settle(free);
        }
      }
      const slot = open;
      if (!slot || slot.batches >= BATCHES) {
        for (let i = 0; i < count; i++) again(pages[i], true);
        return settlement;
      }
      const at = slot.batches ? slot.ends[slot.batches - 1] : 0;
      for (let i = 0; i < count; i++) {
        slot.pages[at + i] = pages[i];
        slot.views[at + i] = views[i];
      }
      slot.ends[slot.batches] = at + count;
      encoder.copyBufferToBuffer(output, OUT_FLAGS * 4, slot.buffer, slot.batches * 4, 4);
      slot.batches++;
      return settlement;
    },
    /** Once the frame's batches are encoded: whether its requests were copied
     *  (`lightCutReports.ts`). Until said, a frame's coarse pages count as not reported. */
    reported(copied: boolean) {
      if (open) open.reported = copied;
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
