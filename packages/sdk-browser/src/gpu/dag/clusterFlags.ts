// The flags word of a hot record (`layout.ts`, `HOT_FLAGS`): `packClusterFlags` packs it, the
// shader and the oracle read it.

/** Bit 0 is free: it said the cluster had no parent, which only the pinned-root fallback read. */
export const CLUSTER_NEVER = 2,
  /** The cluster is blended: its triangle share is counted apart, as on the CPU. */
  CLUSTER_TRANSPARENT = 4;
/** Detail level travels in the flags' high bits: a single pass reads it, at emit. */
export const CLUSTER_LEVEL_SHIFT = 8;
