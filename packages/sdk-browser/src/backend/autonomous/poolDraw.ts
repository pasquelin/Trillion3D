import { sessionGeometryPool } from '../../residency/sessionPool.ts';
import type { PoolEnvironment } from './pool.ts';
import type { PageShare } from './poolSearch.ts';

/**
 * The pool drawn from the budget (`sessionGeometryPool`): slots of the catalogue's largest decoded
 * page, for the copies the scene and its root cover hold. It is drawn again when the root cover's
 * revision moves, and each page's share of the slots is weighed with it: the root cover is held
 * before the cut charges anything, so its pages charge nothing.
 */
export function drawGeometryPool(
  env: Pick<
    PoolEnvironment,
    | 'budgetBytes'
    | 'ceilingBytes'
    | 'maxResidentPages'
    | 'descriptors'
    | 'rootUrls'
    | 'copies'
    | 'coverRevision'
  >,
) {
  const { budgetBytes, ceilingBytes, maxResidentPages, rootUrls, copies, coverRevision } = env;
  // A page's decoded size is the bytes it holds resident: its indices and its float attributes.
  let pageBytes = 1;
  const shares = new Map<string, PageShare>();
  for (const [url, descriptor] of env.descriptors) {
    pageBytes = Math.max(pageBytes, descriptor.uncompressedBytes);
    shares.set(url, { pass: 0, slots: 0 });
  }
  const drawSession = () =>
    sessionGeometryPool(
      { pageBytes, uniquePages: copies.scene(), rootPages: copies.root(), maxResidentPages },
      budgetBytes,
      ceilingBytes,
    );
  const weighShares = () => {
    for (const [url, share] of shares) share.slots = rootUrls.has(url) ? 0 : copies.of(url);
  };
  let session = drawSession(),
    pool = session.pool,
    drawnFor = coverRevision();
  weighShares();
  const current = () => {
    const revision = coverRevision();
    if (revision !== drawnFor) {
      drawnFor = revision;
      session = drawSession();
      pool = session.poolFor(pool.budgetBytes);
      weighShares();
    }
    return pool;
  };
  return {
    /** The pool as drawn now. */
    current,
    /** Each page's share of the slots, by URL (`slotsOf`). */
    shares: shares as ReadonlyMap<string, PageShare>,
    /** Another budget, under the session ceiling; an invalid one is refused before anything
     *  changes. */
    resize(bytes: number) {
      current();
      pool = session.poolFor(bytes);
    },
  };
}
