import { refreshSurface, type PageSurface } from './surface.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { rowsMoved, rowsUnread, type RowsReading } from '../webgpu/row/dirty.ts'

/** The distinct surfaces of a row table's packed rows, and the rows and table age they were
 *  read at; held per table, so a runtime that never draws a row keeps nothing. */
type RowSurfaces = { read: RowsReading; epoch: number; surfaces: PageSurface[] }
const rowSurfaces = new WeakMap<object, RowSurfaces>()

/**
 * The surfaces rows `[0, count)` wear, each once: the rows are walked again only once written, or
 * once the table ages — a record takes another surface in place (`wearDeclaration`) under a new
 * age, before its rows are written again.
 */
export function surfacesOfRows(rows: WebgpuPagesRuntime['layout']['rows']) {
  let held = rowSurfaces.get(rows)
  if (!held) rowSurfaces.set(rows, (held = { read: rowsUnread(), epoch: -1, surfaces: [] }))
  const moved = rowsMoved(held.read, rows.packedRecs, rows.packedCount, rows.rowWrites)
  if (!moved && held.epoch === rows.tableEpoch) return held.surfaces
  held.epoch = rows.tableEpoch
  const seen = new Set<PageSurface>()
  let last: PageSurface | undefined
  for (let i = 0; i < rows.packedCount; i++) {
    const surface = rows.packedRecs[i]?.material
    // Rows of one surface run together: the run skips the set.
    if (!surface || surface === last) continue
    last = surface
    seen.add(surface)
  }
  held.surfaces = [...seen]
  return held.surfaces
}

/** What a frame asks of the rows' surfaces: whether one of them, read fresh, answers `true`. */
export type SurfaceQuestion = (surface: PageSurface) => boolean | undefined

/**
 * Whether a surface rows `[0, count)` wear answers `question` (each refreshed first), one answer
 * held per surface list: taken again only once `surfacesOfRows` walked the rows again — a row
 * written, the table aged, as a material's new values do (`refreshWebgpuMaterials`) —, else read
 * where it was held. A frame over still rows and materials asks it in O(1), however many surfaces
 * they wear.
 */
export function someRowSurface(question: SurfaceQuestion) {
  const answers = new WeakMap<readonly PageSurface[], boolean>()
  return (rows: WebgpuPagesRuntime['layout']['rows']) => {
    const surfaces = surfacesOfRows(rows)
    let answer = answers.get(surfaces)
    if (answer === undefined) {
      answer = surfaces.some((surface) => !!question(refreshSurface(surface)))
      answers.set(surfaces, answer)
    }
    return answer
  }
}
