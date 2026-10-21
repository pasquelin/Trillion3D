import { FLAG_BLEND_CASTER, FLAG_MASK, ROW_WORDS } from '../../visibility/types.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { layerSlot } from '../../geometry/rows/page/pageRowMaterial.ts'
import { FAR_VALUE } from '../../../../math/src/constants.ts'
import { nameCastRow } from '../../placement/rows/rowWords.ts'
import { rootPageRow } from '../../placement/compose/composedRows.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

const EVERYWHERE_MIN = [-FAR_VALUE, -FAR_VALUE, -FAR_VALUE],
  EVERYWHERE_MAX = [FAR_VALUE, FAR_VALUE, FAR_VALUE]
/** The rows whose shadow reads their colour map's alpha: a cutout's, and a blended caster's. */
const ALPHA_READERS = FLAG_MASK | FLAG_BLEND_CASTER

/** The lights the shadows of rows are staled under, and the rows pass that stales them. */
type ShadowRuntime = Pick<WebgpuPagesRuntime, 'lights' | 'rowWords'>

/** The page-table rows the invalidation reads: their words, and the record each row draws. */
interface ShadowRowTable {
  rowCount: number
  /** The blended casters' rows, `[blendFirst, casterSlots)`. */
  blendFirst: number
  casterSlots: number
  pageTableInts: Uint32Array | undefined
  packedRecs: ArrayLike<PageRec | undefined>
}

/**
 * Colour tiles of textures `slots` are resident, or have left: the alpha cutout the shadow pass
 * reads has just changed for every masked surface that carries one of these textures — and the
 * coverage of every blended caster that does (`../../lighting/shadows/transmittance.ts`) —, and a
 * map drawn at the previous level would describe foliage that is no longer the image's. The
 * pages the spheres of those rows cover go stale at the frame's next invalidation, under the
 * ordinary Shadows stage budget (`shadowsFollowRows`) — and those alone: a colour tile of a texture
 * no cutout reads changes no depth, and stales nothing. One scan of the page table per pump,
 * whatever the tiles served. At `-1` the pool changed without naming a texture — a resize — and every
 * page restarts. Without this signal, two identical runs produced two different shadows,
 * depending on when each page had been drawn.
 */
export function shadowsFollowTextures(
  rt: ShadowRuntime,
  rows: ShadowRowTable,
  slots: ReadonlySet<number> | -1,
  /** The colour atlas's slots, by texture: where a row's surface's colour map lies. */
  mapLayer: ReadonlyMap<Texture, number>,
) {
  if (!rt.lights.store.count) return
  if (slots === -1) {
    rt.lights.changes.representationChanged(EVERYWHERE_MIN, EVERYWHERE_MAX)
    return
  }
  const ints = rows.pageTableInts
  if (!ints || !slots.size) return
  shadowsFollowRows(rt, rows, (row) => {
    const base = row * ROW_WORDS
    return (
      !!(ints[base + PAGE_INFO.at.flags] & ALPHA_READERS) &&
      slots.has(layerSlot(mapLayer, rows.packedRecs[row]?.material.map))
    )
  })
}

/**
 * Surfaces whose alpha mode or cutoff a page changed: the depth their rows cast is no longer
 * the one drawn, whether they cut it before or not: the shadow pages over those rows alone are drawn
 * again at once, as a node shown or hidden is (`../render/worldUpload.ts`), not when the camera rests.
 */
export function shadowsFollowSurfaces(
  rt: ShadowRuntime,
  rows: ShadowRowTable,
  surfaces: ReadonlySet<PageSurface>,
) {
  if (rt.lights.store.count)
    shadowsFollowRows(rt, rows, (row) =>
      surfaces.has(rows.packedRecs[row]?.material as PageSurface),
    )
}

/**
 * The world's cells that switched between their placements and their HLOD actors since the last
 * image (`GpuSelection.switchedPages`): the rows of the representation a cell draws now cast where
 * they stand, those of the one it left no more — the casters obey the cut's switch
 * (`../../geometry/dag/shader/worldGateWgsl.ts`, `worldDraws`) —, so each is named to the rows'
 * shadow changes (`nameCastRow`): the pages its sphere covers are drawn again in the same image, as
 * a primitive added or removed stales its bounds. Without the list no shadow page was drawn from a
 * row yet: the switches wait, and the buffer made stales every page (`spheresMadeAnew`).
 */
export function shadowsFollowCells(rt: ShadowRuntime & Pick<WebgpuPagesRuntime, 'run' | 'layout'>) {
  if (!rt.lights.casts) return
  rt.run.gpuSelection?.switchedPages((world, rank) => {
    const row = rootPageRow(rt, world, rank)
    if (row >= 0) nameCastRow(rt, row)
  })
}

/**
 * Names the rows, visibility then blended casters, that `stale` says hold a page, to the rows'
 * shadow changes (`nameCastRow`), once each however often named: the rows pass stales each by the
 * sphere it holds for it before deriving it again — moving casters alone when the row moves, the
 * static layer left as it is (`staleRow`, `../../placement/rows/rowCastWgsl.ts`). No sphere is made
 * here. Without the list, no sphere buffer holds a row's yet: no shadow page was drawn from one, and
 * the buffer made stales every page (`spheresMadeAnew`).
 */
function shadowsFollowRows(
  rt: ShadowRuntime,
  rows: ShadowRowTable,
  stale: (row: number) => boolean,
) {
  if (!rt.lights.casts) return
  for (const [from, to] of [
    [0, rows.rowCount],
    [rows.blendFirst, rows.casterSlots],
  ])
    for (let row = from; row < to; row++)
      if (rows.packedRecs[row] && stale(row)) nameCastRow(rt, row)
}

/**
 * Serves tiles requested by the previous image, except during a pose barrier: the shadow
 * drain replays the image without admitting new ones. An arriving tile invalidates every
 * map (`shadowsFollowTextures`) and the queue would never empty. Returns the tiles served.
 */
export function pumpResidentTiles(
  textures: { pump: (frame: number) => { served: number } } | undefined,
  frame: number,
  converging: boolean,
) {
  return (!converging && textures?.pump(frame).served) || 0
}
