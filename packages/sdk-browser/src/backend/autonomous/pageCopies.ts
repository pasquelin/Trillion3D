import type { PageRec } from '../../page/selection/selection.ts';
import { type PageCopies } from './pool.ts';

/**
 * The copies each page holds once resident (`PageCopies`), from the records collected when the
 * backend opens: those that own their geometry, and whether rows share one more. Every classic
 * instance clones each record that owns its geometry and shares the rows' one (`instances.ts`):
 * the counts follow the instance count, and nothing is walked again after this.
 */
export function pageCopies(
  byUrl: ReadonlyMap<string, readonly PageRec[]>,
  /** Whether a record is placed by rows, read through its first instance (a per-page property). */
  placedByRow: (rec: PageRec) => boolean,
  rootUrls: ReadonlySet<string>,
  instanceCount: () => number,
  /** The pages the roots' groups replace, which the floor holds with them (`rootChildren`). */
  childUrls: ReadonlySet<string>,
): PageCopies {
  const owned = new Map<string, number>(),
    shared = new Set<string>();
  let sceneOwned = 0;
  const root = { owned: 0, shared: 0 },
    floor = { owned: 0, shared: 0 };
  for (const [url, recs] of byUrl) {
    let own = 0;
    for (const rec of recs)
      if (placedByRow(rec)) shared.add(url);
      else own++;
    owned.set(url, own);
    sceneOwned += own;
    const held = rootUrls.has(url) ? root : childUrls.has(url) ? floor : undefined;
    if (held) {
      held.owned += own;
      if (shared.has(url)) held.shared++;
    }
  }
  const each = () => 1 + instanceCount();
  const copiesOf = (held: typeof root) => held.owned * each() + held.shared;
  return {
    of: (url) => (owned.get(url) ?? 0) * each() + (shared.has(url) ? 1 : 0),
    root: () => copiesOf(root),
    floor: () => copiesOf(root) + copiesOf(floor),
    scene: () => sceneOwned * each() + shared.size,
  };
}
