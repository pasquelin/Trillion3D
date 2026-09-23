import { LIGHT_SETTINGS, MAX_SHADOW_SLICES } from '../light/contracts.ts';

const ENTRIES: number = LIGHT_SETTINGS.shadowTableEntries;

/**
 * THE PAGE TABLE, host side: one word per virtual page of every shadow light — the physical page
 * it maps to and whether that page's draw has landed — and the range each light holds in it.
 *
 * The words are the GPU buffer's mirror, and a frame uploads only the words it changed, grouped
 * in contiguous runs. A light's range is claimed first-fit when it takes a slice and freed when
 * it leaves: the table is fixed, and a light that finds no room is denied its shadow.
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
  /** First free offset where `count` words fit between the ranges already held. */
  const fit = (count: number) => {
    let at = 0;
    for (let moved = true; moved;) {
      moved = false;
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) {
        if (base[slice] < 0 || base[slice] >= at + count || base[slice] + size[slice] <= at)
          continue;
        at = base[slice] + size[slice];
        moved = true;
      }
    }
    return at + count <= ENTRIES ? at : -1;
  };
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
    sizeOf: (slice: number) => size[slice],
    /** Claims `count` words for `slice`; false when the table has no such room. */
    claim(slice: number, count: number) {
      if (base[slice] >= 0 && size[slice] === count) return true;
      this.release(slice);
      const at = fit(count);
      if (at < 0) return false;
      base[slice] = at;
      size[slice] = count;
      layoutEpoch++;
      return true;
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
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
        if (base[slice] >= 0 && entry >= base[slice] && entry < base[slice] + size[slice])
          return slice;
      return -1;
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
