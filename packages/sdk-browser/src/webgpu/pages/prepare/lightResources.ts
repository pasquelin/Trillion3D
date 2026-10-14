import { FLAG_BLEND_CASTER, FLAG_MASK, ROW_WORDS } from '../../../visibility/types.ts'
import type { PageRec } from '../../../page/selection/types.ts'
import type { PageSurface } from '../../../page/surface.ts'
import type { WebgpuLightState } from '../state/lights.ts'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'
import { layerSlot } from '../../row/pageRowMaterial.ts'
import { FAR_VALUE } from '../../../../../math/src/constants.ts'
import { nameCastRow } from '../../shadow/castChanges.ts'

const EVERYWHERE_MIN = [-FAR_VALUE, -FAR_VALUE, -FAR_VALUE],
  EVERYWHERE_MAX = [FAR_VALUE, FAR_VALUE, FAR_VALUE]
/** The rows whose shadow reads their colour map's alpha: a cutout's, and a blended caster's. */
const ALPHA_READERS = FLAG_MASK | FLAG_BLEND_CASTER

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
 * coverage of every blended caster that does (`../../../gpu/shadow/transmittance.ts`) —, and a
 * map drawn at the previous level would describe foliage that is no longer the image's. The
 * pages the spheres of those rows cover go stale at the frame's next invalidation, under the
 * ordinary Shadows stage budget (`shadowsFollowRows`) — and those alone: a colour tile of a texture
 * no cutout reads changes no depth, and stales nothing. One scan of the page table per pump,
 * whatever the tiles served. At `-1` the pool changed without naming a texture — a resize — and every
 * page restarts. Without this signal, two identical runs produced two different shadows,
 * depending on when each page had been drawn.
 */
export function shadowsFollowTextures(
  lights: WebgpuLightState,
  rows: ShadowRowTable,
  slots: ReadonlySet<number> | -1,
  /** The colour atlas's slots, by texture: where a row's surface's colour map lies. */
  mapLayer: ReadonlyMap<Texture, number>,
) {
  if (!lights.store.count) return
  if (slots === -1) {
    lights.changes.representationChanged(EVERYWHERE_MIN, EVERYWHERE_MAX)
    return
  }
  const ints = rows.pageTableInts
  if (!ints || !slots.size) return
  shadowsFollowRows(lights, rows, (row) => {
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
  lights: WebgpuLightState,
  rows: ShadowRowTable,
  surfaces: ReadonlySet<PageSurface>,
) {
  if (lights.store.count)
    shadowsFollowRows(lights, rows, (row) =>
      surfaces.has(rows.packedRecs[row]?.material as PageSurface),
    )
}

/**
 * Names the rows, visibility then blended casters, that `stale` says hold a page, to the rows'
 * shadow changes (`nameCastRow`): the GPU stales each by the sphere the rows pass holds for it, at
 * the frame's rows pass — moving casters alone when the row moves, the static layer left as it is
 * (`../../shadow/namedCastsWgsl.ts`). No sphere is made here. Without the list, no sphere buffer
 * holds a row's yet: no shadow page was drawn from one, and the buffer made stales every page
 * (`spheresMadeAnew`).
 */
function shadowsFollowRows(
  lights: WebgpuLightState,
  rows: ShadowRowTable,
  stale: (row: number) => boolean,
) {
  const casts = lights.casts
  if (!casts) return
  for (const [from, to] of [
    [0, rows.rowCount],
    [rows.blendFirst, rows.casterSlots],
  ])
    for (let row = from; row < to; row++)
      if (rows.packedRecs[row] && stale(row)) nameCastRow(casts, row)
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

import { PAGE_INFO } from '../../../visibility/pageInfo.ts'
