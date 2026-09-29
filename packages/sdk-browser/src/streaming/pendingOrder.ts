import type { MatrixElements } from '../math/matrixElements.ts';

/**
 * The storage `orderPendingUrls` (`priority.ts`) keeps from one frame to the next: the bundles'
 * worst error and distance in flat arrays, one view per distinct pose, and the order sorted in
 * place. A call rewrites them from the start (`begin`); a map entry is this call's only when its
 * index is below the call's count and names it back, so nothing is cleared. The arrays grow by
 * doubling and entries no longer asked for are pruned once they outnumber the live ones: a frame
 * that asks for no more than an earlier one allocates nothing.
 */
export function createPendingScratch() {
  return {
    /** Bundles this call, in first-seen order: url, worst error, its distance. */
    count: 0,
    urls: [] as string[],
    errors: new Float64Array(64),
    distances: new Float64Array(64),
    slotOf: new Map<string, number>(),
    /** Poses this call: each one's view and stretch. */
    viewCount: 0,
    matrices: [] as MatrixElements[],
    views: [] as Float64Array[],
    stretches: new Float64Array(16),
    viewOf: new Map<MatrixElements, number>(),
    /** Bundle indices, sorted in place, and the merge's other half. */
    order: new Uint32Array(64),
    merge: new Uint32Array(64),
  };
}
export type PendingScratch = ReturnType<typeof createPendingScratch>;

const grown = (array: Float64Array<ArrayBuffer>, n: number) => {
  if (array.length >= n) return array;
  const next = new Float64Array(Math.max(n, 2 * array.length));
  next.set(array);
  return next;
};

export const begin = (s: PendingScratch) => {
  s.count = 0;
  s.viewCount = 0;
};

/** The index of `matrix`'s view this call, and whether it is new: the caller then writes it. */
export function viewSlot(s: PendingScratch, matrix: MatrixElements) {
  const at = s.viewOf.get(matrix);
  if (at !== undefined && at < s.viewCount && s.matrices[at] === matrix) return at;
  const i = s.viewCount++;
  s.matrices[i] = matrix;
  s.viewOf.set(matrix, i);
  if (i === s.views.length) s.views.push(new Float64Array(16));
  s.stretches = grown(s.stretches, i + 1);
  return ~i;
}

/** Keeps, for `key`, the worst error seen this call, the nearer at equal error. */
export function note(s: PendingScratch, key: string, error: number, distance: number) {
  const at = s.slotOf.get(key);
  if (at !== undefined && at < s.count && s.urls[at] === key) {
    const held = s.errors[at];
    if (error > held || (error === held && distance < s.distances[at])) {
      s.errors[at] = error;
      s.distances[at] = distance;
    }
    return;
  }
  const i = s.count++;
  s.urls[i] = key;
  s.slotOf.set(key, i);
  s.errors = grown(s.errors, i + 1);
  s.distances = grown(s.distances, i + 1);
  s.errors[i] = error;
  s.distances[i] = distance;
}

/** Drops the map entries no call has named for a while: they outnumber this call's. */
function prune(s: PendingScratch) {
  if (s.slotOf.size > 2 * s.count + 256)
    for (const [key, at] of s.slotOf) if (at >= s.count || s.urls[at] !== key) s.slotOf.delete(key);
  if (s.viewOf.size > 2 * s.viewCount + 64)
    for (const [matrix, at] of s.viewOf)
      if (at >= s.viewCount || s.matrices[at] !== matrix) s.viewOf.delete(matrix);
}

/** `b` goes before `a`: a larger error, or a nearer bundle at equal error. */
const before = (s: PendingScratch, b: number, a: number) =>
  s.errors[b] > s.errors[a] || (s.errors[b] === s.errors[a] && s.distances[b] < s.distances[a]);

/**
 * Writes this call's urls into `into`, most costly absence first, the nearer at equal error, the
 * first seen at equal both. Without NaN that order is total, so a stable merge sort on the kept
 * arrays yields exactly what `Array.prototype.sort` did on the bundles in first-seen order. A NaN
 * makes the comparison inconsistent, and there only the engine's own sort reproduces the order it
 * gave: that frame sorts as before, allocating its copy.
 */
export function sortInto(s: PendingScratch, into: string[]) {
  const n = s.count;
  if (s.order.length < n) {
    s.order = new Uint32Array(Math.max(n, 2 * s.order.length));
    s.merge = new Uint32Array(s.order.length);
  }
  let nan = false;
  for (let i = 0; i < n; i++) {
    s.order[i] = i;
    nan ||= s.errors[i] !== s.errors[i] || s.distances[i] !== s.distances[i];
  }
  let sorted = s.order;
  if (nan) {
    const { errors: e, distances: d } = s;
    sorted.set(Array.from(sorted.subarray(0, n)).sort((a, b) => e[b] - e[a] || d[a] - d[b]));
  } else sorted = mergeSort(s, n);
  for (let i = 0; i < n; i++) into[i] = s.urls[sorted[i]];
  into.length = n;
  prune(s);
  return into;
}

/** Bottom-up stable merge sort of `s.order[0, n)`; returns the half that holds the result. */
function mergeSort(s: PendingScratch, n: number) {
  let from = s.order,
    to = s.merge;
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n),
        hi = Math.min(lo + 2 * width, n);
      // The right run goes first only when it strictly precedes: equal entries keep their order.
      for (let k = lo, i = lo, j = mid; k < hi; k++)
        to[k] = j < hi && (i === mid || before(s, from[j], from[i])) ? from[j++] : from[i++];
    }
    const swap = from;
    from = to;
    to = swap;
  }
  return from;
}
