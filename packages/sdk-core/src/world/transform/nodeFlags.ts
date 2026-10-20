// The state bits of a transform node (`TransformTree.flags`), kept apart from the tree so the links
// that read them need not import it.

/** `matrixAutoUpdate`: the local matrix is recomposed from position, rotation, scale. */
export const NODE_AUTO_UPDATE = 1
/** Pose or local matrix written since the last composition. */
export const NODE_TRS_DIRTY = 2
/** Local matrix or parent changed since the last world-matrix calculation. */
export const NODE_LOCAL_CHANGED = 4
/** The world-needs-update mark, which only the update rule reads. */
export const NODE_WORLD_NEEDS_UPDATE = 8
export const NODE_ALIVE = 16
/** Held in `listed` until the next frame pass, kept by a freed slot so a reuse lists it once. */
export const NODE_LISTED = 32
/**
 * The world matrix of a leaf is composed by something else — the GPU, under its parent
 * (`setNodeWorldLazy`): the frame pass does not walk it, no subtree walk reaches it, and a read
 * of its world refreshes it on the spot (`updateNodeWorldMatrix`, with its ancestors), from the
 * same inputs by the same product: the bits the pass would have written, when they are read.
 */
export const NODE_WORLD_LAZY = 64
