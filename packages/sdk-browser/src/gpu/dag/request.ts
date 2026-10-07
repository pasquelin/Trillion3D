/**
 * The BROADCAST REQUEST: what a frame brings back down from the GPU so the host knows what to
 * load, and in which order.
 *
 * The cut ordered its ranks by an atomic counter, hence by nothing: the host uploaded in the
 * order the threads had won the race. What decides who arrives first is the REPLACEMENT'S SCREEN
 * ERROR — a missing cluster is drawn by a coarser ancestor, and that ancestor's error is exactly
 * what the eye sees. The GPU carries that value (`projected`, proven mirror of
 * `clusterErrorPixels`) and ranks every request by it (`shader/snapshotWgsl.ts`).
 *
 * A request is STAGED as two words, the page then its priority, where the frame copy never reads;
 * `dagSortRequests` writes the snapshot from them by rank, the PAGE ALONE, thirty-two bits: a
 * request names any packed instance (placement x page) of an open world, and the frame copy keeps
 * one word per request. The priority's top bit says the request comes from the view AHEAD of the
 * camera (`shader/aheadWgsl.ts`); the nine bits below are the replacement's error, quantized
 * LOGARITHMICALLY and monotone: it only ranks, and a constant relative step keeps as much precision
 * on a one-pixel error as on a thousand-pixel one. Two neighbouring errors may fall in the same
 * step — order between them is then indifferent: ties are not broken.
 *
 * The RANK the GPU sorts by (`requestRank`, `shader/snapshotWgsl.ts`) puts every visible request
 * before every request ahead — the deadline of the first is now —, the larger error first. A request
 * ahead ranks by its DEADLINE first — the share of the horizon before the camera needs it
 * (`aheadDue.ts`), the sooner first — then by its error. The host reads the requests in that order
 * and ranks nothing.
 *
 * A pool too small for the whole cut (`SelectionUniforms.admitByLevel`) ranks the visible tier by
 * ADMISSION instead, as the residency budget says (docs/RESIDENCY.md): the pages the minimum
 * capacity holds first (`../../residency/minimumCapacity.ts`), then the coarsest level, then the
 * larger error, in the same nine bits. The host admits the head of the list as it comes.
 */
export const REQUEST_PRIORITY_BITS = 10
/** The whole priority field. */
export const REQUEST_PRIORITY_MAX = (1 << REQUEST_PRIORITY_BITS) - 1
/** The priority bit of a request ahead of the camera: the field's top bit. */
export const REQUEST_AHEAD = (REQUEST_PRIORITY_MAX + 1) >> 1
/** The highest error step of the visible tier. */
export const REQUEST_STEP_MAX = REQUEST_AHEAD - 1
/** Words of a staged request: its page, then its priority (`shader/snapshotWgsl.ts`). */
export const REQUEST_STAGED_WORDS = 2
/** Quantization step: sixteen steps per error doubling, as before the tier bit, over thirty-two
 *  doublings — four billion pixels, past any finite error a screen projects; the near plane
 *  reached is `Infinity`, the tier's highest step. */
export const REQUEST_PRIORITY_SCALE = 16
/** A request ahead splits its nine bits: three for its deadline, eight steps of the horizon — about
 *  two frames each at 60 Hz over the published 250 ms —, six for its error, two steps per doubling
 *  over the same thirty-two doublings. */
export const REQUEST_DUE_STEPS = 8,
  REQUEST_AHEAD_ERROR_BITS = 6,
  REQUEST_AHEAD_SCALE = 2
export const AHEAD_ERROR_MAX = (1 << REQUEST_AHEAD_ERROR_BITS) - 1
/** A visible request ranked by admission splits its nine bits: one for the minimum capacity's
 *  pages, five for the level — thirty-two, past any cooked DAG —, three for the error, one step
 *  per four doublings over the same thirty-two. */
export const ADMISSION_LEVEL_BITS = 5,
  ADMISSION_ERROR_BITS = 3,
  ADMISSION_SCALE = 0.25
export const ADMISSION_LEVEL_MAX = (1 << ADMISSION_LEVEL_BITS) - 1,
  ADMISSION_ERROR_MAX = (1 << ADMISSION_ERROR_BITS) - 1
/** The minimum capacity's bit of an admission priority, above every level. */
export const ADMISSION_FLOOR = 1 << (ADMISSION_LEVEL_BITS + ADMISSION_ERROR_BITS)
/** An admission priority's level and floor bit, its error step dropped: what the readback counts
 *  the camera's requests by (`readoutWords.ts`, `levelCountsWord`), the floor's 32 levels above
 *  the others'. */
export const ADMISSION_BUCKETS = 2 << ADMISSION_LEVEL_BITS
