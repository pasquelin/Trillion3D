import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import { SHADOW_TABLE_ENTRIES as ENTRIES, SHADOW_TABLE_STRIDE as STRIDE } from './virtual.ts';

/**
 * THE PAGE TABLE, host side: one word per virtual page of every shadow light — the physical page
 * it maps to and whether that page's draw has landed — and the range each light holds in it.
 *
 * The words are the GPU buffer's mirror, and a frame uploads only the words it changed, grouped
 * in contiguous runs. Each slice owns a fixed span of `SHADOW_TABLE_STRIDE` words, the largest
 * range a light needs: a light's range starts at its slice's span, so every slice finds room and
 * no shadow light is ever denied for want of table.
 */
export function createShadowTable(poolPages: number) {
  /** Words rewritten in one frame before the upload falls back to the whole table. */
  const changedCap = poolPages * 4;
  const words = new Uint32Array(ENTRIES);
  const base = new Int32Array(MAX_SHADOW_SLICES).fill(-1),
    size = new Int32Array(MAX_SHADOW_SLICES);
  const queued = new Uint8Array(ENTRIES),
    changed = new Int32Array(changedCap);
  let changedCount = 0,
    whole = true,
    layoutEpoch = 0,
    version = 0;
  const write = (entry: number, value: number) => {
    if (words[entry] === value) return;
    words[entry] = value;
    version++;
    if (whole || queued[entry]) return;
    if (changedCount >= changedCap) {
      whole = true;
      return;
    }
    queued[entry] = 1;
    changed[changedCount++] = entry;
  };
  return {
    words,
    get entries() {
      return ENTRIES;
    },
    /** Rises whenever a range is claimed or freed: requests read against another layout drop. */
    get layoutEpoch() {
      return layoutEpoch;
    },
    /** Rises with every word that changes: what the shading reads, and so asks, changed. */
    get version() {
      return version;
    },
    baseOf: (slice: number) => base[slice],
    /** Claims `count` words, at most `SHADOW_TABLE_STRIDE`, at the start of `slice`'s span. */
    claim(slice: number, count: number) {
      if (base[slice] >= 0 && size[slice] === count) return;
      base[slice] = slice * STRIDE;
      size[slice] = count;
      layoutEpoch++;
    },
    /** Frees the range of `slice`; its words must already be unmapped by the caller. */
    release(slice: number) {
      if (base[slice] < 0) return;
      base[slice] = -1;
      size[slice] = 0;
      layoutEpoch++;
    },
    /** The slice whose range holds `entry`, or −1. */
    sliceAt(entry: number) {
      const slice = Math.floor(entry / STRIDE);
      return base[slice] >= 0 && entry - base[slice] < size[slice] ? slice : -1;
    },
    write,
    /**
     * Hands the words changed since the last call, as contiguous runs `(first, count)`, or the
     * whole table once after a burst the list could not hold. Nothing when nothing changed.
     */
    flush(upload: (first: number, count: number) => void) {
      if (whole) {
        whole = false;
        for (let i = 0; i < changedCount; i++) queued[changed[i]] = 0;
        changedCount = 0;
        upload(0, ENTRIES);
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
    },
    reset() {
      words.fill(0);
      base.fill(-1);
      size.fill(0);
      queued.fill(0);
      changedCount = 0;
      whole = true;
      layoutEpoch++;
    },
  };
}

export type ShadowTable = ReturnType<typeof createShadowTable>;
