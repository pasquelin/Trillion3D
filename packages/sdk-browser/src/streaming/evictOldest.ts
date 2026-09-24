/**
 * The eviction order the host-memory pools share — the page streamer's cache and the WebGL2
 * geometry pool: entries leave oldest first, in the insertion order of the `Map` or `Set` that
 * holds them (a touch re-inserts, so the order is recency), skipping those `kept` names, until
 * `over` turns false. `evict` may delete the entry from `order` while it is being walked. Returns
 * how many left.
 */
export function evictOldest(
  order: Iterable<string>,
  over: () => boolean,
  kept: (key: string) => boolean,
  evict: (key: string) => void,
) {
  let evicted = 0;
  for (const key of order) {
    if (!over()) break;
    if (kept(key)) continue;
    evict(key);
    evicted++;
  }
  return evicted;
}
