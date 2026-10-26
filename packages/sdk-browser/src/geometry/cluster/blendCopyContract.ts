/**
 * The transparent draw copy.
 *
 * A blended or transmissive surface is not drawn by the opaque path: the engine holds one copy per
 * placement — the source mesh's own pose, or each row of its instance buffer — and reads it
 * everywhere else through this contract, the record it builds (`blendCopyRecord.ts`). What the
 * engine reads of a copy is here and nothing more: the geometry it draws, the surface record it
 * wears, the pose it shares with the engine's world storage, and the source mesh it stands for.
 */

import type { DrawSource } from '../selection/drawSource.ts'
import type { MatrixElements } from '../../session/host/matrixElements.ts'
import type { PageSurface } from '../pages/surface.ts'
import type { PlacementOf } from '../../placement/rows/rows.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { VertexAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'

/** What the engine reads on a transparent copy. Its `geometry` is the source one, with the index
 *  it draws and its local box on demand; its `matrix` is the engine's world storage for the
 *  source mesh, shared and never written through the copy (`blendCopyRecord.ts`). */
export type BlendCopy = {
  readonly geometry: Geometry & {
    getIndex(): VertexAttribute | null
    computeBoundingBox(): void
  }
  /** What the engine reads of the surface: its own record. */
  readonly surface: PageSurface
  /** Rebound onto the same row of a larger buffer when its owner's rows grow (`placement/growth/growth.ts`). */
  matrix: MatrixElements
  /** The row of an instance buffer the copy is posed by, when its mesh is placed by rows: one
   *  copy per row, `matrix` a view on it, skipped while the row is parked. */
  placement?: PlacementOf
  /** True while the host hides the source mesh or one of its ancestors (`placement/hidden.ts`). */
  hidden?: boolean
  renderOrder: number
  /** The source mesh the copy stands for: none for the world DAG's blended sections
   *  (`ClusterRoot.mixed`). */
  readonly drawSource?: DrawSource
  /** The attribute flags of the quantized geometry its pages carry and it reads in place
   *  (`FLAG_UV`…, `page/format.ts`), set by the catalogue. */
  pageFlags?: number
  /** A paged copy's local box — its root's (`ClusterRoot.localBox`), what every page it may draw
   *  lies in, grown by their grid's error —, absent on one whose pages deform. */
  localBox?: Float64Array
}
