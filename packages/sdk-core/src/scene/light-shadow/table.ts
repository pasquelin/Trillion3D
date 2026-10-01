import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import {
  SHADOW_TABLE_ENTRIES as ENTRIES,
  SUN_WINDOW,
  shadowTableEntries,
  shadowTableStride,
} from './virtual.ts';

/** Host bytes a table over `poolPages` pages allocates: a word and a change flag per entry, a
 *  base and a size per slice, four changed, four withdrawn and four sent words per pool page.
 *  `hostBytes` counts the arrays. */
export function shadowTableHostBytes(poolPages: number, entries = ENTRIES) {
  return entries * (4 + 1) + MAX_SHADOW_SLICES * (4 + 4) + 3 * poolPages * 4 * 4;
}

/** An entry's flags: its word waits in `changed`; it waits to go out withdrawn; it went out
 *  withdrawn unmapped and no GPU page draw ran since (`withdrawUnmapped`). */
const QUEUED = 1,
  WITHDRAWN = 2,
  SENT = 4;

/**
 * THE PAGE TABLE, host side: one word per virtual page of every shadow light — the physical page
 * it maps to and whether that page's draw has landed — and the range each light holds in it.
 *
 * The words are the GPU buffer's mirror, and a frame uploads only the words it changed, grouped
 * in contiguous runs. Each slice owns a fixed span of `SHADOW_TABLE_STRIDE` words, the largest
 * range a light needs: a light's range starts at its slice's span, so every slice finds room and
 * no shadow light is ever denied for want of table. The extent is the session's: a reference one
 * raises it (`referenceMode.ts`), the ordinary constant by default.
 */
export function createShadowTable(poolPages: number, pages = SUN_WINDOW) {
  const stride = shadowTableStride(pages),
    entries = shadowTableEntries(pages);
  /** Words rewritten in one frame before the upload falls back to the whole table. */
  const changedCap = poolPages * 4;
  const words = new Uint32Array(entries);
  const base = new Int32Array(MAX_SHADOW_SLICES).fill(-1),
    size = new Int32Array(MAX_SHADOW_SLICES);
  /** Per entry: `QUEUED` while its word waits in `changed`, `WITHDRAWN` while it waits in
   *  `withdrawnList` (`withdraw`). */
  const queued = new Uint8Array(entries),
    changed = new Int32Array(changedCap),
    withdrawnList = new Int32Array(changedCap),
    sentList = new Int32Array(changedCap);
  let changedCount = 0,
    withdrawnCount = 0,
    sentCount = 0,
    whole = true;
  const queue = (entry: number) => {
    if (whole || queued[entry] & QUEUED) return;
    if (changedCount >= changedCap) {
      whole = true;
      return;
    }
    queued[entry] |= QUEUED;
    changed[changedCount++] = entry;
  };
  const write = (entry: number, value: number) => {
    const word = value >>> 0;
    if (words[entry] === word) return;
    words[entry] = word;
    table.version++;
    queue(entry);
  };
  /** Each entry of `list`'s first `count` that carries `flag` — past the list, every entry's. */
  const eachFlagged = (
    list: Int32Array,
    count: number,
    flag: number,
    visit: (e: number) => void,
  ) => {
    if (count <= changedCap) for (let i = 0; i < count; i++) visit(list[i]);
    else for (let e = 0; e < entries; e++) if (queued[e] & flag) visit(e);
  };
  const unflagWithdrawn = (e: number) => void (queued[e] &= ~WITHDRAWN),
    unflagSent = (e: number) => void (queued[e] &= ~SENT);
  /** The withdrawn marks the flush sent. */
  const clearWithdrawn = () => {
    eachFlagged(withdrawnList, withdrawnCount, WITHDRAWN, unflagWithdrawn);
    withdrawnCount = 0;
  };
  const table = {
    words,
    /** Bytes of every host array the table holds: what `shadowTableHostBytes` declares. */
    hostBytes: [words, base, size, queued, changed, withdrawnList, sentList].reduce(
      (sum, a) => sum + a.byteLength,
      0,
    ),
    entries,
    /** Rises whenever a range is claimed or freed: requests read against another layout drop. */
    layoutEpoch: 0,
    /** Rises with every word that changes: what the shading reads, and so asks, changed. */
    version: 0,
    baseOf: (slice: number) => base[slice],
    /** Claims `count` words, at most `SHADOW_TABLE_STRIDE`, at the start of `slice`'s span. */
    claim(slice: number, count: number) {
      if (base[slice] >= 0 && size[slice] === count) return;
      base[slice] = slice * stride;
      size[slice] = count;
      table.layoutEpoch++;
    },
    /** Frees the range of `slice`; its words must already be unmapped by the caller. */
    release(slice: number) {
      if (base[slice] < 0) return;
      base[slice] = -1;
      size[slice] = 0;
      table.layoutEpoch++;
    },
    /** The slice whose range holds `entry`, or −1. */
    sliceAt(entry: number) {
      const slice = Math.floor(entry / stride);
      return base[slice] >= 0 && entry - base[slice] < size[slice] ? slice : -1;
    },
    write,
    /** `entry`'s page is withdrawn, whoever drew it: its word goes out at the next flush, changed
     *  or not, marked (`withdrawn`) — the GPU may hold a draw of its own the host never saw
     *  (`wordsWgsl.ts`). */
    withdraw(entry: number) {
      table.version++;
      if (!(queued[entry] & WITHDRAWN)) {
        queued[entry] |= WITHDRAWN;
        if (withdrawnCount < changedCap) withdrawnList[withdrawnCount] = entry;
        withdrawnCount++;
      }
      queue(entry);
    },
    /** True while `entry` waits to go out withdrawn: read by the flush's sink. */
    withdrawn: (entry: number) => (queued[entry] & WITHDRAWN) !== 0,
    /** Each entry waiting to go out withdrawn: what a whole upload sends beside the words (#831). */
    eachWithdrawn: (visit: (entry: number) => void) =>
      eachFlagged(withdrawnList, withdrawnCount, WITHDRAWN, visit),
    /** `entry`, which the host does not map, is withdrawn — a box covered it while the GPU may hold
     *  a draw of its own (`invalidate.ts`) —, once until a GPU page draw runs again (`gpuDrew`):
     *  before that, the GPU holds no newer draw of it to withdraw. */
    withdrawUnmapped(entry: number) {
      if (queued[entry] & SENT) return;
      queued[entry] |= SENT;
      if (sentCount < changedCap) sentList[sentCount] = entry;
      sentCount++;
      table.withdraw(entry);
    },
    /** The GPU drew pages of its own: an entry withdrawn unmapped may be drawn again. */
    gpuDrew() {
      eachFlagged(sentList, sentCount, SENT, unflagSent);
      sentCount = 0;
    },
    /**
     * Hands the words changed since the last call, as contiguous runs `(first, count)`, or the
     * whole table once after a burst the list could not hold. Nothing when nothing changed.
     */
    flush(upload: (first: number, count: number) => void) {
      if (whole) {
        whole = false;
        upload(0, entries);
        for (let i = 0; i < changedCount; i++) queued[changed[i]] &= ~QUEUED;
        changedCount = 0;
        clearWithdrawn();
        return;
      }
      changed.subarray(0, changedCount).sort();
      for (let i = 0; i < changedCount;) {
        let last = i;
        while (last + 1 < changedCount && changed[last + 1] === changed[last] + 1) last++;
        upload(changed[i], last - i + 1);
        for (let k = i; k <= last; k++) queued[changed[k]] &= ~QUEUED;
        i = last + 1;
      }
      changedCount = 0;
      clearWithdrawn();
    },
    reset() {
      words.fill(0);
      base.fill(-1);
      size.fill(0);
      queued.fill(0);
      changedCount = withdrawnCount = sentCount = 0;
      whole = true;
      table.layoutEpoch++;
    },
  };
  return table as Readonly<typeof table>;
}

export type ShadowTable = ReturnType<typeof createShadowTable>;
