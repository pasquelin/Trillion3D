// The flags word of a hot record (`layout.ts`, `HOT_FLAGS`): `packClusterFlags` packs it, the
// shader and the oracle read it.

/** The cluster is owned by no culling leaf: never selected. */
export const CLUSTER_NEVER = 2,
  /** The cluster is blended: its triangle share is counted apart, as on the CPU. */
  CLUSTER_TRANSPARENT = 4
/** Detail level travels in the flags' high bits: a single pass reads it, at emit. */
export const CLUSTER_LEVEL_SHIFT = 8
