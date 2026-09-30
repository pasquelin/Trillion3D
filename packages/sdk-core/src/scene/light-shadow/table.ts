import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import {
  SHADOW_TABLE_ENTRIES as ENTRIES,
  SUN_WINDOW,
  shadowTableEntries,
  shadowTableStride,
} from './virtual.ts';

/** Host bytes a table over `poolPages` pages allocates: a word and a change flag per entry, a
 *  base and a size per slice, four changed and four withdrawn words per pool page. `hostBytes`
 *  counts the arrays. */
export function shadowTableHostBytes(poolPages: number, entries = ENTRIES) {
  return entries * (4 + 1) + MAX_SHADOW_SLICES * (4 + 4) + 2 * poolPages * 4 * 4;
}

const QUEUED = 1,
  WITHDRAWN = 2;

/** Words a table holding `held` grows to for `wanted`: twice as many, or `wanted` if more, never
 *  past `most` — the host's arrays and the GPU's buffer alike (`gpu/shadow/shadowData.ts`). */
export const grownShadowEntries = (held: number, wanted: number, most: number) =>
  Math.min(most, Math.max(wanted, 2 * held));

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
  let words = new Uint32Array(stride),
    follows = false;
  const base = new Int32Array(MAX_SHADOW_SLICES).fill(-1),
    size = new Int32Array(MAX_SHADOW_SLICES);
  /** Per entry: `QUEUED` while its word waits in `changed`, `WITHDRAWN` while it waits in
   *  `withdrawnList` (`withdraw`). */
  let queued = new Uint8Array(stride);
  const changed = new Int32Array(changedCap),
    withdrawnList = new Int32Array(changedCap);
  let changedCount = 0,
    withdrawnCount = 0,
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
  /** The withdrawn marks the flush sent: past the list, every entry's. */
  const clearWithdrawn = () => {
    if (withdrawnCount > changedCap) for (let e = 0; e < queued.length; e++) queued[e] &= QUEUED;
    else for (let i = 0; i < withdrawnCount; i++) queued[withdrawnList[i]] &= QUEUED;
    withdrawnCount = 0;
  };
  /** The words and their marks grown to `held`, kept. */
  const hold = (held: number) => {
    if (held <= words.length) return;
    const grown = new Uint32Array(held),
      marks = new Uint8Array(held);
    grown.set(words);
    marks.set(queued);
    [words, queued, table.words, table.heldEntries] = [grown, marks, grown, held];
  };
  const table = {
    /** The words held (`heldEntries`): replaced when they grow. */
    words,
    /** Bytes the host arrays reach, every slice's span held: what `shadowTableHostBytes`
     *  declares. */
    hostBytes: shadowTableHostBytes(poolPages, entries),
    entries,
    /** Words held, host and GPU alike (`gpu/shadow/shadowData.ts`): one span, grown with the
     *  slices claimed (`grownShadowEntries`), as Unreal gives page-table entries only to the
     *  lights in use. Never shrunk: a freed slice's pages may still be named by the GPU's pool
     *  until it evicts them. A data field: the table keeps fast properties. */
    heldEntries: stride,
    /** Words the slices asked past those held while the table follows the GPU's (`follow`). */
    wantedEntries: 0,
    /** Rises whenever a range is claimed or freed: requests read against another layout drop. */
    layoutEpoch: 0,
    /** Rises with every word that changes: what the shading reads, and so asks, changed. */
    version: 0,
    baseOf: (slice: number) => base[slice],
    /** From now on the words grow when the GPU's table did (`hold`): a slice past them waits. */
    follow() {
      follows = true;
    },
    /** Grows the words to `held`, the GPU's table grown to as many. */
    hold,
    /** Whether `slice`'s span lies in the words held: grown to it at once, unless the table
     *  follows the GPU's, which says no until then and notes the words wanted (`wantedEntries`),
     *  a span past the slice's, so that the next light finds its span held. */
    fits(slice: number) {
      const end = (slice + 1) * stride;
      if (follows)
        table.wantedEntries = Math.max(table.wantedEntries, Math.min(entries, end + stride));
      if (end <= words.length) return true;
      if (follows) return false;
      hold(grownShadowEntries(words.length, end, entries));
      return true;
    },
    /** Claims `count` words, at most `SHADOW_TABLE_STRIDE`, at the start of `slice`'s span. */
    claim(slice: number, count: number) {
      if (base[slice] >= 0 && size[slice] === count) return;
      table.fits(slice);
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
    /**
     * Hands the words changed since the last call, as contiguous runs `(first, count)`, or the
     * whole table once after a burst the list could not hold. Nothing when nothing changed.
     */
    flush(upload: (first: number, count: number) => void) {
      if (whole) {
        whole = false;
        upload(0, words.length);
        for (let i = 0; i < changedCount; i++) queued[changed[i]] = 0;
        changedCount = 0;
        clearWithdrawn();
        return;
      }
      changed.subarray(0, changedCount).sort();
      for (let i = 0; i < changedCount;) {
        let last = i;
        while (last + 1 < changedCount && changed[last + 1] === changed[last] + 1) last++;
        upload(changed[i], last - i + 1);
        for (let k = i; k <= last; k++) queued[changed[k]] = 0;
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
      changedCount = withdrawnCount = 0;
      whole = true;
      table.layoutEpoch++;
    },
  };
  return table as Readonly<typeof table>;
}

export type ShadowTable = ReturnType<typeof createShadowTable>;
