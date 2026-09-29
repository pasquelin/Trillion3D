/**
 * The BROADCAST REQUEST: what a frame brings back down from the GPU so the host knows what to
 * load, and in which order.
 *
 * The cut ordered its ranks by an atomic counter, hence by nothing: the host uploaded in the
 * order the threads had won the race. The WebGL2 path has always ranked by the REPLACEMENT'S
 * SCREEN ERROR (`../../streaming/priority.ts`, `orderPendingUrls`) — a missing cluster is drawn by a
 * coarser ancestor, and that ancestor's error is exactly what the eye sees: it is what decides
 * who arrives first. The GPU now carries the same value, computed by the same formula
 * (`projected`, proven mirror of `clusterErrorPixels`).
 *
 * One WORD per request, so the frame copy stays what it is: the page in the low 22 bits —
 * 4,194,304 clusters, against 1,959,792 on the largest measured scene —, the priority in the high
 * 10. The priority's top bit says the request comes from the view AHEAD of the camera
 * (`shader/aheadWgsl.ts`); the nine bits below are the replacement's error, quantized
 * LOGARITHMICALLY and monotone: it only ranks, and a constant relative step keeps as much precision
 * on a one-pixel error as on a thousand-pixel one. Two neighbouring errors may fall in the same
 * step — order between them is then indifferent, as it is on the reference, which does not break
 * ties either.
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
const REQUEST_DUE_STEPS = 8,
  REQUEST_AHEAD_ERROR_BITS = 6,
  REQUEST_AHEAD_SCALE = 2;
const AHEAD_ERROR_MAX = (1 << REQUEST_AHEAD_ERROR_BITS) - 1;

/** Error step of `pixels` at `scale` steps per doubling, bounded by `max`; `Infinity` takes `max`. */
function errorStep(pixels: number, scale: number, max: number) {
  if (!(pixels > 0)) return 0;
  if (!Number.isFinite(pixels)) return max;
  return Math.min(max, Math.max(0, Math.round(Math.log2(1 + pixels) * scale)));
}

/** Priority of a visible request's error in pixels, monotone increasing and bounded in its tier.
 *  `Infinity` takes the tier's highest step: a cluster nothing replaces is what is missing most. */
export const quantizeRequestPriority = (pixels: number) =>
  errorStep(pixels, REQUEST_PRIORITY_SCALE, REQUEST_STEP_MAX);

/** Priority of a request ahead: needed `due` of the horizon from now (0 now, 1 at the horizon), the
 *  sooner the higher, then its error. A deadline that reads as no number is the latest. */
export function quantizeAheadPriority(pixels: number, due: number) {
  const last = REQUEST_DUE_STEPS - 1,
    late = due > 0 ? Math.min(last, Math.floor(due * REQUEST_DUE_STEPS)) : due <= 0 ? 0 : last;
  return (
    REQUEST_AHEAD |
    ((last - late) << REQUEST_AHEAD_ERROR_BITS) |
    errorStep(pixels, REQUEST_AHEAD_SCALE, AHEAD_ERROR_MAX)
  );
}
/** The order a priority is served in, highest first: the visible tier above the tier ahead. */
export const requestRank = (priority: number) => priority ^ REQUEST_AHEAD;

export const packRequest = (page: number, priority: number) =>
  ((priority << REQUEST_PAGE_BITS) | page) >>> 0;
export const requestPage = (word: number) => word & (REQUEST_PAGE_MAX - 1);
export const requestPriority = (word: number) => word >>> REQUEST_PAGE_BITS;
/** The rank of a request word: what `dagSortRequests` orders by. */
export const requestWordRank = (word: number) => requestRank(requestPriority(word));
/** In `words[start, end)`, sorted by rank, the first request of the view ahead: every visible
 *  request comes before it. */
export function firstAheadRequest(words: ArrayLike<number>, start = 0, end = words.length) {
  let at = start;
  while (at < end && !(requestPriority(words[at]) & REQUEST_AHEAD)) at++;
  return at;
}

/**
 * CPU mirror of `dagSortRequests` (`shader/snapshotWgsl.ts`), what the oracle and the Node device
 * replay: the words by `requestRank`, highest first, in one count and one scatter over the ranks.
 * Within a rank it keeps the order the words came in, one of the orders the kernel's threads give.
 */
export function sortRequestWords(words: ArrayLike<number>) {
  const place = new Uint32Array(REQUEST_PRIORITY_MAX + 1);
  for (let i = 0; i < words.length; i++) place[requestWordRank(words[i])]++;
  for (let rank = REQUEST_PRIORITY_MAX, first = 0; rank >= 0; rank--) {
    const held = place[rank];
    place[rank] = first;
    first += held;
  }
  const sorted = new Uint32Array(words.length);
  for (let i = 0; i < words.length; i++) sorted[place[requestWordRank(words[i])]++] = words[i];
  return sorted;
}

/**
 * WGSL mirror, bit for bit. WGSL `log2` and JavaScript `Math.log2` need not return the same
 * last bit, so rounding may split two neighbouring steps: the published order remains that of
 * the errors, only the boundary between two steps is floating. That is why the proof compares
 * ORDERS and not words.
 */
export const DAG_REQUEST_WGSL = `const PAGE_BITS:u32=${REQUEST_PAGE_BITS}u;
const REQUEST_AHEAD:u32=${REQUEST_AHEAD}u;
fn errorStep(pixels:f32,scale:f32,top:i32)->u32{
 if(!(pixels>0.0)){return 0u;}
 if(pixels>=INF){return u32(top);}
 return u32(clamp(i32(round(log2(1.0+pixels)*scale)),0,top));
}
fn quantizePriority(pixels:f32)->u32{return errorStep(pixels,${REQUEST_PRIORITY_SCALE}.0,${REQUEST_STEP_MAX});}
/** \`quantizeAheadPriority\`: the deadline's step, the sooner the higher, then the error's. */
fn aheadPriority(pixels:f32,due:f32)->u32{
 let late=u32(clamp(floor(due*${REQUEST_DUE_STEPS}.0),0.0,${REQUEST_DUE_STEPS - 1}.0));
 return REQUEST_AHEAD|((${REQUEST_DUE_STEPS - 1}u-late)<<${REQUEST_AHEAD_ERROR_BITS}u)|errorStep(pixels,${REQUEST_AHEAD_SCALE}.0,${AHEAD_ERROR_MAX});
}
fn packRequest(page:u32,priority:u32)->u32{return (priority<<PAGE_BITS)|page;}
fn requestWordRank(word:u32)->u32{return (word>>PAGE_BITS)^REQUEST_AHEAD;}
`;
