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
 * 4,194,304 clusters, against 1,959,792 on the largest measured scene —, the quantized
 * priority in the high 10. Quantization is LOGARITHMIC and monotone: it only ranks, and a
 * constant relative step keeps as much precision on a one-pixel error as on a thousand-pixel
 * one. Two neighbouring errors may fall in the same step — order between them is then
 * indifferent, as it is on the reference, which does not break ties either.
 */
const REQUEST_PAGE_BITS = 22;
export const REQUEST_PAGE_MAX = 1 << REQUEST_PAGE_BITS;
export const REQUEST_PRIORITY_MAX = 1023;
/** Quantization step: sixteen steps per error doubling, over sixty-four doublings. */
export const REQUEST_PRIORITY_SCALE = 16;

/** Priority of an error in pixels, monotone increasing and bounded. `Infinity` takes the
 *  highest step: a cluster nothing replaces is what is missing most. */
export function quantizeRequestPriority(pixels: number) {
  if (!(pixels > 0)) return 0;
  if (!Number.isFinite(pixels)) return REQUEST_PRIORITY_MAX;
  const pas = Math.round(Math.log2(1 + pixels) * REQUEST_PRIORITY_SCALE);
  return Math.min(REQUEST_PRIORITY_MAX, Math.max(0, pas));
}

export const packRequest = (page: number, priority: number) =>
  ((priority << REQUEST_PAGE_BITS) | page) >>> 0;
export const requestPage = (word: number) => word & (REQUEST_PAGE_MAX - 1);
export const requestPriority = (word: number) => word >>> REQUEST_PAGE_BITS;

/**
 * WGSL mirror, bit for bit. WGSL `log2` and JavaScript `Math.log2` need not return the same
 * last bit, so rounding may split two neighbouring steps: the published order remains that of
 * the errors, only the boundary between two steps is floating. That is why the proof compares
 * ORDERS and not words.
 */
export const DAG_REQUEST_WGSL = `const PAGE_BITS:u32=${REQUEST_PAGE_BITS}u;
fn quantizePriority(pixels:f32)->u32{
 if(!(pixels>0.0)){return 0u;}
 if(pixels>=INF){return ${REQUEST_PRIORITY_MAX}u;}
 let pas=i32(round(log2(1.0+pixels)*${REQUEST_PRIORITY_SCALE}.0));
 return u32(clamp(pas,0,${REQUEST_PRIORITY_MAX}));
}
fn packRequest(page:u32,priority:u32)->u32{return (priority<<PAGE_BITS)|page;}
`;
