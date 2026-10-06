import { type CameraMotion } from '../../camera/world.ts'
import type { PageRec } from '../../page/selection/selection.ts'

/**
 * What one camera owns on the WebGL2 path: the cut it draws, the cut it wants, what it asks the
 * pool for, its motion and its size. Everything else is the scene's and every view shares it: the
 * gate's revisions, the page store, the geometry pool, which admits the union of the views'
 * requests under its one budget (`pool.ts`), and the residency, which holds the union
 * (`poolOrder.ts`, `residency.ts`).
 */
export type WebglViewState = {
  shown: PageRec[]
  /** The packed rank of each shown page, rank by rank: one record serves many placements. */
  shownPacked: number[]
  desired: PageRec[]
  /** The packed rank of each desired page, rank by rank. */
  desiredPacked: number[]
  requested: PageRec[]
  motion: CameraMotion
  /** The main view's is the host's own array, which a resize writes. */
  viewport: [number, number] | undefined
}

export const VIEW_KEYS = [
  'shown',
  'shownPacked',
  'desired',
  'desiredPacked',
  'requested',
  'motion',
  'viewport',
] as const satisfies readonly (keyof WebglViewState)[]
