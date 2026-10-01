import type { ShadowPoolSnapshot } from './mirror.ts';
import type { ShadowRequestReport } from './requests.ts';

/** A readback slot is reusable as soon as delivered; each view keeps its own stable copy. */
export function createViewReport() {
  const kept: ShadowRequestReport = {
    frame: -1,
    layoutEpoch: -1,
    stamp: -1,
    count: 0,
    entries: new Uint32Array(),
  };
  let pool: ShadowPoolSnapshot | undefined;
  return (next: ShadowRequestReport) => {
    kept.frame = next.frame;
    kept.layoutEpoch = next.layoutEpoch;
    kept.stamp = next.stamp;
    kept.count = next.count;
    kept.submission = next.submission;
    kept.generation = next.generation;
    if (kept.entries.length !== next.entries.length)
      kept.entries = new Uint32Array(next.entries.length);
    kept.entries.set(next.entries);
    const source = next.pool;
    if (source) {
      if (!pool || pool.owner.length !== source.owner.length)
        pool = {
          owner: new Int32Array(source.owner.length),
          requested: new Int32Array(source.requested.length),
          allocated: 0,
          refused: 0,
          drawn: 0,
          listings: 0,
        };
      pool.owner.set(source.owner);
      pool.requested.set(source.requested);
      pool.allocated = source.allocated;
      pool.refused = source.refused;
      pool.drawn = source.drawn;
      pool.listings = source.listings;
    }
    kept.pool = source ? pool : undefined;
    return kept;
  };
}
