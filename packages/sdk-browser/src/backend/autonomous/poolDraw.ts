import { sessionGeometryPool } from '../../residency/sessionPool.ts';
import type { PoolEnvironment } from './pool.ts';

/**
 * The pool drawn from the budget (`sessionGeometryPool`): slots of the catalogue's largest decoded
 * page, for the copies the scene and its root cover hold. It is drawn again when instances change
 * those copies, and each page's share of the slots is weighed with it: the root cover is held
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
    | 'shares'
  >,
) {
  const { rootUrls, copies, shares } = env;
  // A page's decoded size is the bytes it holds resident: its indices and its float attributes.
  let pageBytes = 1;
  for (const descriptor of env.descriptors.values())
    pageBytes = Math.max(pageBytes, descriptor.uncompressedBytes);
  const drawSession = () =>
    sessionGeometryPool(
      {
        pageBytes,
        uniquePages: copies.scene(),
        rootPages: copies.root(),
        maxResidentPages: env.maxResidentPages,
      },
      env.budgetBytes,
      env.ceilingBytes,
    );
  const weighShares = () => {
    for (const [url, share] of shares) share.slots = rootUrls.has(url) ? 0 : copies.of(url);
  };
  let session = drawSession(),
    pool = session.pool,
    drawnFor = copies.generation;
  weighShares();
  const current = () => {
    if (copies.generation !== drawnFor) {
      drawnFor = copies.generation;
      session = drawSession();
      pool = session.poolFor(pool.budgetBytes);
      weighShares();
    }
    return pool;
  };
  return {
    /** The pool as drawn now. */
    current,
    /** Another budget, under the session ceiling; an invalid one is refused before anything
     *  changes. */
    resize(budgetBytes: number) {
      current();
      pool = session.poolFor(budgetBytes);
    },
  };
}
