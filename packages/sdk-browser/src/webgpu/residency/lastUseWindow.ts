import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'

/**
 * Frames a page stays held once the image stopped using it. The drawn list reaches the cache
 * through the readback slots, so the GPU may have drawn that many frames the cache has not read
 * yet, and one more is being encoded: a page unused for this many frames is unused by every frame
 * the GPU can still be drawing. The rule follows the frame pipeline, never a scene.
 */
export const LAST_USE_WINDOW = DAG_READBACK_SLOTS + 1
