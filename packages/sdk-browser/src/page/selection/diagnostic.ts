import type { PageRec } from './types.ts'
import { HLOD_INDEX, packDiagnosticWord, proxiedHlod } from '../../diagnostic/colors.ts'
import { levelDiagnostic } from '../../visibility/pageInfo.ts'

/**
 * The HLOD coloration index of a drawn page (`HLOD_INDEX`), one per primitive: an HLOD actor's
 * index is `level0 + its layer`, so a world page is `level0 + its layer` (`PageRec.hlodLayer`,
 * 1 to 3) — its layer, never a level of the mesh inside it —, and a placement drawn as its cell's
 * HLOD 0 actor (`proxy`, the source meshes instanced) is `level0`. A placement drawn as itself is
 * `none`: under the cell partition no primitive has an HLOD parent of its own, the cell switch
 * alone picks what draws, so no child index exists to show.
 */
function hlodIndex(rec: Pick<PageRec, 'hlodLayer'>, proxy: boolean) {
  if (rec.hlodLayer !== undefined) return HLOD_INDEX.level0 + rec.hlodLayer
  return proxiedHlod(HLOD_INDEX.none, proxy)
}

/** A page's diagnostic word (`DIAGNOSTIC_WORD`): its level, its HLOD index — `proxy`, its
 *  placement drawn as its cell's HLOD 0 actor — and its error, written with its row, never per
 *  image: a placement switching rewrites its rows (`../../webgpu/pages/prepare/worldRoot.ts`). */
export function pageDiagnosticWord(
  rec: Pick<PageRec, 'level' | 'role' | 'lodError' | 'hlodLayer'>,
  proxy = false,
) {
  return packDiagnosticWord(levelDiagnostic(rec), hlodIndex(rec, proxy), rec.lodError ?? 0)
}
