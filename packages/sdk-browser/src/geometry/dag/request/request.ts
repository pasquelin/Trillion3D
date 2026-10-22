/**
 * The REQUESTS a cut publishes: what a frame brings back down from the GPU so the host knows what
 * to load, and how urgently.
 *
 * Every leaf the cut keeps and sees — in the frustum, needed at the threshold, not too coarse,
 * under neither pyramid — is asked for once, in the order the threads won the counter
 * (`../shader/levelWgsl.ts`, `depositLeaf`) — no node of a world actor whose cell does not draw it
 * is kept (`worldNodeHides`) —; a leaf hidden by the pyramids asks for nothing. A leaf is the
 * clusters of one group, a run of consecutive packed pages that may lie in more than one streaming
 * page, so a request is three words, at the same rank of three lists (`../readoutWords.ts`): the first packed page — a
 * whole word, any packed instance (placement x page) of an open world —, how many pages follow it,
 * and its PRIORITY: the leaf's replaced error over the threshold, a float one or more for a leaf
 * the cut needs (`leafPriority`, `../shader/error.ts`), its bits shifted under the view's category
 * (`requestPriority`), so the words order as the floats do.
 *
 * The GPU ranks nothing. The host takes, per streaming page, the largest priority any request gave
 * it, raises each page a request depends on to one above its child's, and starts the highest first
 * (`../../residency/`).
 */
/** The category of the camera's requests: the priority word's top two bits, the highest. */
export const REQUEST_CATEGORY = 3
/** The priority words a request takes: never zero — the host's heap reads zero as no request —,
 *  and room above the highest for the parents the host raises one above their children. */
export const REQUEST_PRIORITY_MIN = 1,
  REQUEST_PRIORITY_MAX = 0xffffffe0
