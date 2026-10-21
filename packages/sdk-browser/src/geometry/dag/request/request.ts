/**
 * The REQUESTS a cut publishes: what a frame brings back down from the GPU so the host knows what
 * to load, and how urgently.
 *
 * Every page of a leaf the cut keeps and sees — in the frustum, needed at the threshold, not too
 * coarse, under neither pyramid — is asked for, in the order the threads won the counter
 * (`../shader/levelWgsl.ts`, `depositLeaf`) — no node of a world actor whose cell does not draw it
 * is kept (`worldNodeHides`) —; a leaf hidden by the pyramids asks for nothing. Each
 * request is its page, a whole word — any packed instance (placement x page) of an open world —, and
 * its PRIORITY, a word of its own at the same rank of the readout's priority list
 * (`../readoutWords.ts`): the leaf's replaced error over the threshold, a float one or more for a
 * leaf the cut needs (`leafPriority`, `../shader/error.ts`), its bits shifted under the view's
 * category (`requestPriority`), so the words order as the floats do.
 *
 * The GPU ranks nothing. The host takes, per page, the largest priority any request gave it, raises
 * each page a request's group closes over to one above its child's, and starts the highest first
 * (`../../residency/`).
 */
/** The category of the camera's requests: the priority word's top two bits, the highest. */
export const REQUEST_CATEGORY = 3
/** The priority words a request takes: never zero — the host's heap reads zero as no request —,
 *  and room above the highest for the parents the host raises one above their children. */
export const REQUEST_PRIORITY_MIN = 1,
  REQUEST_PRIORITY_MAX = 0xffffffe0
