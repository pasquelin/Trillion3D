import { matrixWindingCw } from '../../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../../page/selection/types.ts';

/**
 * Winding of a cluster: true when the world matrix reverses orientation, which swaps the culled
 * face. It is a 3×3 determinant, and it changes only when the matrix changes — never between two
 * images of a still scene. It was nonetheless recomputed for every page and every image, up to four
 * times per page depending on the draw paths.
 *
 * The epoch is the row table's, which the engine already increments as soon as a world matrix may
 * have moved: `renderWebgpuPages` posts it at the head of the image, and a cluster whose epoch
 * matches yields the already-computed value. One extra epoch only recomputes.
 */
let epoque = 0;

/** Posts the image's epoch. Beyond it, every memoised winding is taken back to zero. */
export function setWindingEpoch(valeur: number) {
  epoque = valeur;
}

export function windingCw(rec: PageRec) {
  if (rec.windingEpoch === epoque && rec.windingCw !== undefined) return rec.windingCw;
  const cw = matrixWindingCw(rec.matrix.elements);
  rec.windingEpoch = epoque;
  rec.windingCw = cw;
  return cw;
}
