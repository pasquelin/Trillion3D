/**
 * THE BLENDED FAMILY OF A COLLECTION'S PRIMITIVES (`collect.ts`): whether a primitive's pages are
 * drawn blended or opaque, at the open, and the family each record takes again
 * once a material moved into or out of blended inside the session (#846).
 */
import { wearsOneOf } from '../pages/surface.ts'
import type { PageRec } from './types.ts'
import type { DrawSource } from './drawSource.ts'
import { isAssignment, type AlphaChange } from '../../placement/engineSceneUpdates.ts'

/** Whether a primitive's pages are drawn blended at the open — a surface that transmits too: its
 *  pages stream and coarsen as any, the transparent pass composing them
 *  (`../../blend/prepare.ts`). No opaque page stands in for it; past its cell, its HLOD wears
 *  its material flattened opaque, or blended as it is on a merged layer's section
 *  (`../hlod/worldRecords.ts`). A material moved between draw classes later puts them in the
 *  family of its new class alone (`blendOf`). */
export const pagesBlend = (primitive: { pass?: string }, surface: BlendedSurface) =>
  primitive.pass === 'clustered-blend' || surfaceBlends(surface)

type BlendedSurface = { transparent: boolean; transmission: number }
/** Whether a surface is drawn blended: transparent, or transmitting. */
export const surfaceBlends = (surface: BlendedSurface) =>
  surface.transparent || surface.transmission > 0
/** Whether the transparent pass draws pages of `root`: a blended root's every page, or the
 *  blended pages of a root that mixes them with opaque ones (`ClusterRoot.mixed`). */
export const rootBlends = (root: {
  pages: readonly { transparent?: boolean }[]
  mixed?: boolean
}) => !!root.mixed || !!root.pages[0]?.transparent

/** Whether `root` is drawn by the transparent pass alone: blended, mixing no opaque page. */
export const rootBlended = (root: {
  pages: readonly { transparent?: boolean }[]
  mixed?: boolean
}) => !root.mixed && !!root.pages[0]?.transparent

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
