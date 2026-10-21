import type { PageRec } from './types.ts'
import { drawnAsHlod, HLOD_INDEX, packDiagnosticWord } from '../../diagnostic/colors.ts'
import { levelDiagnostic } from '../../visibility/pageInfo.ts'

/**
 * The HLOD coloration index of a drawn page (`HLOD_INDEX`), one per primitive: an HLOD actor's
 * index is `level0 + its layer`, so a world page is `level0 + its layer` (`PageRec.hlodLayer`,
 * its actor's HLOD level) — its layer, never a level of the mesh inside it —, a placement drawn as
 * its cell's HLOD 0 actor (`drawnAs` 0, the source meshes instanced) is `level0`, and a row of an
 * instanced actor (`drawnAs`, that actor's HLOD level) is that actor's. A placement drawn as
 * itself (`drawnAs` -1) is `none`: under the cell partition no primitive has an HLOD parent of its
 * own, the cell switch alone picks what draws, so no child index exists to show.
 */
function hlodIndex(rec: Pick<PageRec, 'hlodLayer'>, drawnAs: number) {
  if (rec.hlodLayer !== undefined) return HLOD_INDEX.level0 + rec.hlodLayer
  return drawnAsHlod(HLOD_INDEX.none, drawnAs)
}

/** A page's diagnostic word (`DIAGNOSTIC_WORD`): its level, its HLOD index — `drawnAs`, the HLOD
 *  level its placement draws as, -1 itself — and its error, written with its row, never per
 *  image: a placement switching rewrites its rows (`../../frame/prepare/worldRoot.ts`). */
export function pageDiagnosticWord(
  rec: Pick<PageRec, 'level' | 'role' | 'lodError' | 'hlodLayer'>,
  drawnAs = -1,
) {
  return packDiagnosticWord(levelDiagnostic(rec), hlodIndex(rec, drawnAs), rec.lodError ?? 0)
}
