/**
 * The BROADCAST REQUEST: what a frame brings back down from the GPU so the host knows what to
 * load, and in which order.
 *
 * The cut ordered its ranks by an atomic counter, hence by nothing: the host uploaded in the
 * order the threads had won the race. What decides who arrives first is the REPLACEMENT'S SCREEN
 * ERROR — a missing cluster is drawn by a coarser ancestor, and that ancestor's error is exactly
 * what the eye sees. The GPU carries that value (`projected`, proven mirror of
 * `clusterErrorPixels`); the WebGL2 path asks coarsest first in cut order
 * (`../../backend/autonomous/residency.ts`).
 *
 * One WORD per request, so the frame copy stays what it is: the page in the low 22 bits —
 * 4,194,304 clusters, against 1,959,792 on the largest measured scene —, the priority in the high
 * 10. The priority's top bit says the request comes from the view AHEAD of the camera
 * (`shader/aheadWgsl.ts`); the nine bits below are the replacement's error, quantized
 * LOGARITHMICALLY and monotone: it only ranks, and a constant relative step keeps as much precision
 * on a one-pixel error as on a thousand-pixel one. Two neighbouring errors may fall in the same
 * step — order between them is then indifferent: ties are not broken.
 *
 * The RANK the GPU sorts by (`requestRank`, `shader/snapshotWgsl.ts`) puts every visible request
 * before every request ahead — the deadline of the first is now —, the larger error first. A request
 * ahead ranks by its DEADLINE first — the share of the horizon before the camera needs it
 * (`aheadDue.ts`), the sooner first — then by its error. The host reads the requests in that order
 * and ranks nothing.
 */
export const REQUEST_PAGE_BITS = 22;
export const REQUEST_PAGE_MAX = 1 << REQUEST_PAGE_BITS;
/** The whole priority field: the ten bits above the page. */
export const REQUEST_PRIORITY_MAX = (1 << (32 - REQUEST_PAGE_BITS)) - 1;
/** The priority bit of a request ahead of the camera: the field's top bit. */
export const REQUEST_AHEAD = (REQUEST_PRIORITY_MAX + 1) >> 1;
/** The highest error step of the visible tier. */
export const REQUEST_STEP_MAX = REQUEST_AHEAD - 1;
/** Quantization step: sixteen steps per error doubling, as before the tier bit, over thirty-two
 *  doublings — four billion pixels, past any finite error a screen projects; the near plane
 *  reached is `Infinity`, the tier's highest step. */
export const REQUEST_PRIORITY_SCALE = 16;
/** A request ahead splits its nine bits: three for its deadline, eight steps of the horizon — about
 *  two frames each at 60 Hz over the published 250 ms —, six for its error, two steps per doubling
 *  over the same thirty-two doublings. */
export const REQUEST_DUE_STEPS = 8,
  REQUEST_AHEAD_ERROR_BITS = 6,
  REQUEST_AHEAD_SCALE = 2;
export const AHEAD_ERROR_MAX = (1 << REQUEST_AHEAD_ERROR_BITS) - 1;

export const packRequest = (page: number, priority: number) =>
  ((priority << REQUEST_PAGE_BITS) | page) >>> 0;
export const requestPage = (word: number) => word & (REQUEST_PAGE_MAX - 1);
export const requestPriority = (word: number) => word >>> REQUEST_PAGE_BITS;
