/**
 * THE BLENDED FAMILY OF A COLLECTION'S PRIMITIVES (`collect.ts`): whether a primitive is drawn by
 * blended pages, by blended copies, or opaque, at the open, and the family each record takes again
 * once a material moved into or out of blended inside the session (#846).
 */
import { wearsOneOf } from '../surface.ts'
import type { PageRec } from './types.ts'
import type { DrawSource } from './drawSource.ts'
import { blendMoves, isAssignment, type AlphaChange } from '../../placement/engineSceneUpdates.ts'

/** Whether a primitive's pages are drawn blended at the open. A material moved between draw
 *  classes later puts them in the family of its new class alone (`reassignBlend`): its pages are
 *  cut again on that class's grid (`classPages.ts`), as a fresh session of it compiles them. */
export const pagesBlend = (primitive: { pass?: string }, surface: { transparent: boolean }) =>
  primitive.pass === 'clustered-blend' || surface.transparent
/** Whether a primitive is drawn by blended copies alone, no page of its own: a shared blend, or a
 *  surface that transmits. */
export const drawsCopies = (primitive: { pass?: string }, surface: { transmission: number }) =>
  primitive.pass === 'shared-blend' || surface.transmission > 0
/** Whether a primitive is drawn blended — by copies, or by blended pages —: no opaque page, and no
 *  world page, stands in for it (`../../scene/worldRecords.ts`). */
export const drawsBlended = (
  primitive: { pass?: string },
  surface: { transparent: boolean; transmission: number },
) => drawsCopies(primitive, surface) || pagesBlend(primitive, surface)
/** The meshes whose pages a collection drew, whichever read them: a resource mounted in place
 *  (#572) is its own collection, and moves class with the open's records (#837). */
const collected = new WeakSet<DrawSource>()
/** `draw`'s pages were collected (`createCollector`). */
export const noteCollected = (draw: DrawSource) => void collected.add(draw)

/** Whether `alpha` moves the surface a record wears, or gives it another. */
export const wears = ({ drawSource: source }: PageRec, alpha: AlphaChange) =>
  !!source && (isAssignment(alpha) ? alpha.meshes.has(source) : wearsOneOf(source, alpha.surfaces))

/** Whether a record is drawn blended once `alpha` moved its surfaces, before or after they are
 *  written: the family a collection gives the class `alpha.to`, or the one it has. */
export const blendOf = (rec: PageRec, alpha: AlphaChange) =>
  wears(rec, alpha) && collected.has(rec.drawSource!) ? alpha.to === 'blend' : rec.transparent

/** The open's assignment, run again once a material moved into or out of blended inside the
 *  session (#846): each record takes `blendOf`; true when one moved. */
export function reassignBlend(records: readonly PageRec[], alpha: AlphaChange) {
  let moved = false
  for (const rec of blendMoves(alpha) ? records : []) {
    const transparent = blendOf(rec, alpha)
    moved ||= transparent !== rec.transparent
    rec.transparent = transparent
  }
  return moved
}
