/** Every per-page array of a shadow pool of `pages` pages (`pool.ts`): what a page holds and how
 *  current it is. A resize makes them anew (`poolResize.ts`). */
export const shadowPageArrays = (pages: number) => ({
  owner: new Int32Array(pages).fill(-1),
  slice: new Int32Array(pages),
  /** Sun: level. Lamp: `face · 16 + mip`. */
  view: new Int32Array(pages),
  x: new Int32Array(pages),
  y: new Int32Array(pages),
  /** Coarseness within its light (`sunCoarseness`, `lampCoarseness`): the finer goes first. */
  rank: new Int32Array(pages),
  requested: new Int32Array(pages).fill(-1),
  dirty: new Uint8Array(pages),
  /** Its depth is read: drawn since it was mapped, and not withdrawn since (`withdraw`). */
  valid: new Uint8Array(pages),
  /** The static layer holds this page's static casters, current. */
  layered: new Uint8Array(pages),
  /** The depth-range slot its depth and static layer were drawn in (`sunDepth.ts`). */
  range: new Uint8Array(pages),
  /** The footprint it is drawn for (`footprint.ts`), the texels a reader may take: every
   *  receiver's that named it since it was mapped, `PAGE_FOOTPRINT_EMPTY` before one did. */
  footprint: new Uint8Array(pages),
  /** The frame it turned stale — its age in the list (`admit.ts`) —, and since when the image
   *  has read it stale, in ms and frames, NaN unread (`counts.ts`). */
  since: new Float64Array(pages),
  sinceFrame: new Int32Array(pages),
  readFrame: new Int32Array(pages),
});

export type ShadowPageArrays = ReturnType<typeof shadowPageArrays>;

/** Bytes of the page arrays `pages` holds. */
export const shadowPageArraysBytes = (pages: ShadowPageArrays) =>
  (Object.keys(shadowPageArrays(0)) as (keyof ShadowPageArrays)[]).reduce(
    (n, key) => n + pages[key].byteLength,
    0,
  );
