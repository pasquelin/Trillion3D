import { adaptivePixelError } from '../../../../sdk-core/src/index.ts';
import type { CameraMotion, EngineCamera } from '../../camera/world.ts';

export function resolvePixelError(
  context: { pixelError?: number; lodAdaptive?: boolean },
  cam: EngineCamera,
  motion: CameraMotion,
) {
  const base = context.pixelError ?? 0;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  // Speed is that of the eye in the world: a rig that carries the camera moves it too.
  // Position comes from the engine camera, ancestors resolved by the frame entry.
  const eye = cam.eye;
  let speed = 0;
  if (motion.last && motion.lastMs != null) {
    const dt = Math.max((now - motion.lastMs) / 1000, 1e-4);
    const dx = eye[0] - motion.last[0],
      dy = eye[1] - motion.last[1],
      dz = eye[2] - motion.last[2];
    speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
  }
  if (!motion.last) motion.last = new Float64Array(3);
  motion.last.set(eye);
  motion.lastMs = now;
  if (!context.lodAdaptive || !(base > 0)) return base;
  return adaptivePixelError(base, speed, Math.max(cam.far * 0.05, 1));
}
/** The request key of a record: its streaming bundle when the cache has one, its own page otherwise. */
export function pageRequestUrl<T extends { url: string; streamUrl?: string }>(rec: T) {
  return rec.streamUrl ?? rec.url;
}
/** Number distinct request keys once and for all; returns their count. */
export function indexPageRequests<
  T extends { url: string; streamUrl?: string; requestIndex?: number },
>(pages: readonly T[]) {
  const byKey = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    const key = pageRequestUrl(pages[i]);
    let rank = byKey.get(key);
    if (rank === undefined) {
      rank = byKey.size;
      byKey.set(key, rank);
    }
    pages[i].requestIndex = rank;
  }
  return byKey.size;
}
/**
 * Deduplicate request keys without a hash table: one stamp per rank, reused from one
 * frame to the next. A cut of fifteen thousand pages is walked without allocating or hashing.
 */
export class RequestStamps {
  private stamps: Int32Array;
  private current = 0;
  constructor(count: number) {
    this.stamps = new Int32Array(Math.max(0, count));
  }
  /** Open a pass: everything seen before is forgotten. */
  begin() {
    this.current++;
  }
  /** True the first time this rank is seen since `begin()`. An unknown rank is never filtered. */
  first(index: number | undefined) {
    if (index === undefined || index < 0 || index >= this.stamps.length) return true;
    if (this.stamps[index] === this.current) return false;
    this.stamps[index] = this.current;
    return true;
  }
  /**
   * Append to `into` the request address of each record whose rank has not yet been seen
   * since `begin()`. Dedup and write fit in one loop, on the stamp array read as a field and
   * on `into` ranks written directly: a cut of a hundred thousand records no longer pays a
   * call or a stack frame per record. `missing` keeps only pages without bytes — the list of
   * addresses still awaited.
   */
  mark(
    list: readonly {
      url: string;
      streamUrl?: string;
      array?: Uint32Array;
      requestIndex?: number;
    }[],
    into: string[],
    missing = false,
  ) {
    const { stamps, current } = this;
    let count = into.length;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i],
        index = rec.requestIndex;
      if (missing && rec.array) continue;
      if (index !== undefined && index >= 0 && index < stamps.length) {
        if (stamps[index] === current) continue;
        stamps[index] = current;
      }
      into[count++] = rec.streamUrl ?? rec.url;
    }
    into.length = count;
    return into;
  }
}
/**
 * Rank of a catalogue page, or `undefined`: the rank travels on the page itself rather than
 * in a hash table reread per cluster and per frame. The catalogue has the last word — a rank
 * set by another engine does not survive the check, exactly like a page missing from the
 * table used to yield nothing.
 */
export function catalogueIndexOf<T extends { packedIndex?: number }>(
  catalogue: readonly (T | undefined)[],
  rec: T,
) {
  const index = rec.packedIndex;
  return index !== undefined && catalogue[index] === rec ? index : undefined;
}

/**
 * Records grouped by address. The default key is the streaming request, which a path fetching
 * packed cluster-index bundles reads; a path that reads, stores and evicts one geometry page at
 * a time passes `(rec) => rec.url` instead — on a cache whose pages share one bundle the default
 * would file every record of the scene under that single key.
 */
export function indexPagesByUrl<T extends { url: string; streamUrl?: string }>(
  pages: readonly T[],
  keyOf: (rec: T) => string = pageRequestUrl,
) {
  const byUrl = new Map<string, T[]>();
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i],
      key = keyOf(rec);
    let list = byUrl.get(key);
    if (!list) byUrl.set(key, (list = []));
    list.push(rec);
  }
  return byUrl;
}
/** Fallback without stamps: one set for the whole host, cleared on each call. */
const vuesSansEstampille = new Set<string>();
type Requested = { array?: Uint32Array; url: string; streamUrl?: string; requestIndex?: number };
/**
 * Request addresses of the records still missing bytes. A request brings its closure: the missing
 * bundles a record's bundle is installed after (`dependencies`, `./bundleDependencies.ts`) are
 * listed before the records themselves, so a parent outside the cut is fetched too.
 */
export function collectPendingUrls<T extends Requested & { dependencies?: readonly Requested[] }>(
  shown: readonly T[],
  into: string[],
  stamps?: RequestStamps,
) {
  into.length = 0;
  if (stamps) {
    stamps.begin();
    for (let i = 0; i < shown.length; i++) {
      const dependencies = shown[i].dependencies;
      if (dependencies?.length) stamps.mark(dependencies, into, true);
    }
    return stamps.mark(shown, into, true);
  }
  // Fallback without stamps: a host that has not numbered its requests deduplicates by the strings.
  const seen = vuesSansEstampille;
  seen.clear();
  const add = (rec: Requested) => {
    if (rec.array) return;
    const key = pageRequestUrl(rec);
    if (seen.has(key)) return;
    seen.add(key);
    into.push(key);
  };
  for (let i = 0; i < shown.length; i++) shown[i].dependencies?.forEach(add);
  for (let i = 0; i < shown.length; i++) add(shown[i]);
  return into;
}
/** Hand a loaded page or bundle to every record that shares it; a bundled record gets a view at its
 *  own offset, so one request makes dozens of clusters drawable. */
export function acceptPageArray<
  T extends { array?: Uint32Array; indexBytes: number; triangles: number; streamOffset?: number },
>(recs: readonly T[], array: Uint32Array) {
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i],
      offset = rec.streamOffset;
    const view =
      offset === undefined ? array : array.subarray(offset / 4, offset / 4 + rec.triangles * 3);
    rec.array = view;
    rec.indexBytes = view.byteLength;
  }
}
