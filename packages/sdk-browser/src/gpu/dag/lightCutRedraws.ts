import { MAX_SHADOW_PAGES as PAGES } from '../shadow/recordPack.ts';
import { MAX_SHADOW_BATCHES as BATCHES, SHADOW_FLAG_FRAMES } from '../shadow/batchBudget.ts';
import { COARSER_VIEWS, LIST_FULL, WORK_DROPPED } from './shader/viewsWgsl.ts';
import { OUT_FLAGS } from './layout.ts';
import { createViewLimit } from './lightCutViewLimit.ts';
import { DRAW_DYNAMIC } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';

/** A page's redraw bits: withdrawn until redrawn, and its static casters drawn again too. */
const WRONG = 1,
  STATIC = 2;
/** The bit of a page drawn in `mode` (`DRAW_*`): `STATIC` unless the static layer restored it. */
const casterBit = (mode: number) => (mode === DRAW_DYNAMIC ? 0 : STATIC);
/** Merges `bits` into `page`'s entry of `map`. */
const merge = (map: Map<number, number>, page: number, bits: number) =>
  map.set(page, bits | (map.get(page) ?? 0));

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
 *   those of the views that drew coarser, wait for residency to change, then are drawn again, the
 *   camera moving or not (#831, `rest`): a camera that only moves, residency still, redraws no page
 *   whose casters and light stayed where they were. A batch whose requests were
 *   not read — the frame's report not copied, or its list full before the batch's flag — waits
 *   for nothing: what it lacked was never asked for, and its pages are drawn again at once.
 *
 * A page is drawn again as it was drawn: one restored from the static layer (`DRAW_DYNAMIC`) drew
 * its moving casters alone, so only they can have been short, and the static layer stays; one whose
 * static casters were drawn draws them again (#990).
 *
 * A frame's flag words ride in one slot: a buffer of a word per batch, and the batches' pages,
 * sized once for the most batches a frame draws (`../shadow/batchBudget.ts`). `SHADOW_FLAG_FRAMES`
 * slots, allocated at creation, hold that many frames in flight. A frame that finds every slot
 * still read — the GPU that far behind — draws no light-cut page (`ready`): its pages stay stale,
 * read as they were, for a frame with a slot. Drawn on a guess, they would be withdrawn with no
 * cause, and their redraw, as starved, again each frame (#1142).
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
    /** Each page's `STATIC` bit: 0 for a page restored from the static layer. */
    casters: new Uint8Array(BATCHES * PAGES),
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
  /** Each page to draw again, in bits: its depth is wrong — dropped work — and is withdrawn
   *  meanwhile, not only coarser — a missing cluster — and stays read (`WRONG`); its static casters
   *  were drawn short too (`STATIC`). The pages waiting for residency, with the same bits. */
  const redraw = new Map<number, number>(),
    waiting = new Map<number, number>();
  const limit = createViewLimit(viewCap);
  let epoch = 0;
  const again = (bits: number, page: number) => merge(redraw, page, bits);
  /** The slot the frame's next batch copies its flag word into: the open frame's while it has room,
   *  else a free one; none when every slot is still read. */
  const slotFor = () =>
    open ? (open.batches < BATCHES ? open : undefined) : slots.find(({ busy }) => !busy);
  const read = (slot: Slot, batch: number, flags: number) => {
    const from = batch ? slot.ends[batch - 1] : 0,
      to = slot.ends[batch];
    const dropped = (flags & WORK_DROPPED) !== 0;
    let views = 0;
    for (let i = from; i < to; i++) views = Math.max(views, slot.views[i] + 1);
    limit.read(views, dropped);
    if (dropped) {
      for (let i = from; i < to; i++) again(WRONG | slot.casters[i], slot.pages[i]);
      return;
    }
    // Residency moved since the frame was encoded: what it lacked may be there now.
    const now = slot.epoch !== epoch || !slot.reported || (flags & LIST_FULL) !== 0,
      coarser = flags >>> COARSER_VIEWS;
    for (let i = from; i < to; i++)
      if ((coarser >>> slot.views[i]) & 1)
        merge(now ? redraw : waiting, slot.pages[i], slot.casters[i]);
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
    /** Copies a batch's flag word with its `count` drawn `pages`, drawn in the cut's `views` and
     *  in `modes` (`DRAW_*`), once `ready`. The frame's first batch returns the settlement to call
     *  once the command buffer is submitted, or dropped; the others ride in its slot. */
    encode(
      encoder: GPUCommandEncoder,
      pages: ArrayLike<number>,
      views: ArrayLike<number>,
      count: number,
      modes: ArrayLike<number>,
    ) {
      if (!count) return undefined;
      const slot = slotFor();
      // A page drawn without its flag word could not be checked: the caller asks `ready` first.
      if (!slot) throw new Error('light-cut redraws: no flag slot, ask `ready` first');
      let settlement: ((submitted: boolean) => void) | undefined;
      if (slot !== open) {
        open = slot;
        slot.busy = true;
        slot.batches = 0;
        slot.epoch = epoch;
        slot.reported = false;
        settlement = settle(slot);
      }
      const at = slot.batches ? slot.ends[slot.batches - 1] : 0;
      for (let i = 0; i < count; i++) {
        slot.pages[at + i] = pages[i];
        slot.views[at + i] = views[i];
        slot.casters[at + i] = casterBit(modes[i]);
      }
      slot.ends[slot.batches] = at + count;
      encoder.copyBufferToBuffer(output, OUT_FLAGS * 4, slot.buffer, slot.batches * 4, 4);
      slot.batches++;
      return settlement;
    },
    /** Whether the frame's next batch has a slot for its flag word: without, it draws nothing. */
    get ready() {
      return slotFor() !== undefined;
    },
    /** Once the frame's batches are encoded: whether its requests were copied
     *  (`lightCutReports.ts`). Until said, a frame's coarse pages count as not reported. */
    reported(copied: boolean) {
      if (open) open.reported = copied;
    },
    /** Residency the light cuts see changed: the drop goes stale, not forgotten (the limit may
     *  probe upward, `createViewLimit`), and the pages that waited on it are drawn again, the
     *  camera moving or not (#831). */
    residencyChanged() {
      limit.residencyChanged();
      epoch++;
      waiting.forEach(again);
      waiting.clear();
    },
    /** Light views one batch draws in (`value`): `viewCap` until a batch drops, then what fits;
     *  and the batches read as dropped (`dropsRead`) — `createViewLimit`. */
    limit: limit as Pick<typeof limit, 'value' | 'dropsRead'>,
    /** Hands every page to draw again to `visit`, whether it is withdrawn until then, and whether
     *  its static casters are drawn again too; forgets them; returns how many. */
    takeRedraw(visit: (page: number, withdraw: boolean, staticCasters: boolean) => void) {
      const count = redraw.size;
      for (const [page, bits] of redraw) visit(page, (bits & WRONG) !== 0, (bits & STATIC) !== 0);
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
