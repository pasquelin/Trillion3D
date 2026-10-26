import type { PageRec } from '../../selection/types.ts'

/** A cluster holds the geometry it draws: its own quantized page, or its primitive's positions,
 *  which the float vertex pool holds (`../../pages/pool/geometryPool.ts`). Without either, it has no
 *  cluster record. */
export const rowHasGeometry = (rec: PageRec) => !!rec.geometryPage || !!rec.attributes.position
/** Corners the cluster draws: the count the cluster's own geometry page declares, or the length of the
 *  index page for a cluster that still draws from one. A paged cluster never holds an index page —
 *  nothing fetches it — and this is the only number its record ever wanted from it. */
export const rowIndexCount = (rec: PageRec) =>
  rec.geometryPage?.indexCount ?? rec.array?.length ?? 0
