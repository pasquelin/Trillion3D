import { pageDeformationBytes } from '../../deformation/textureBytes.ts';
import { sessionGeometryPool } from '../../residency/sessionPool.ts';
import type { PoolEnvironment } from './pool.ts';
import type { GeometryPool } from '../../residency/pools.ts';

/**
 * The pool drawn from the budget (`sessionGeometryPool`): slots of the catalogue's largest decoded
 * page, for the copies the scene holds, and its floor: the root cover and the pages its groups
 * replace (`../../residency/minimumCapacity.ts`). It is drawn again when the root cover's
 * revision moves, and each page's share of the slots is weighed with it: the root cover is held
 * before the requests charge anything, so its pages charge nothing.
 */
export function drawGeometryPool(
  env: Pick<
    PoolEnvironment,
    | 'budgetBytes'
    | 'fixedBytes'
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
  const shares = new Map<string, number>();
  for (const [url, descriptor] of env.descriptors) {
    pageBytes = Math.max(
      pageBytes,
      descriptor.uncompressedBytes + pageDeformationBytes(descriptor),
    );
    shares.set(url, 0);
  }
  const drawSession = () =>
    sessionGeometryPool(
      {
        fixedBytes: env.fixedBytes?.(),
        pageBytes,
        uniquePages: copies.scene(),
        rootPages: copies.floor(),
        maxResidentPages,
      },
      budgetBytes,
      ceilingBytes,
    );
  const weighShares = () => {
    for (const url of shares.keys()) shares.set(url, rootUrls.has(url) ? 0 : copies.of(url));
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
  const drawFor = (bytes: number) => (current(), session.poolFor(bytes));
  return {
    /** The pool as drawn now. */
    current,
    /** Each page's share of the slots, by URL: the copies it holds once resident. */
    shares: shares as ReadonlyMap<string, number>,
    /** The pool drawn for another budget, under the session ceiling, not adopted; an invalid
     *  budget is refused. */
    drawFor,
    /** Another budget, under the session ceiling; an invalid one is refused before anything
     *  changes. */
    resize(bytes: number) {
      pool = drawFor(bytes);
    },
    /** A pool `drawFor` drew, adopted. */
    adopt(drawn: GeometryPool) {
      pool = drawn;
    },
  };
}
