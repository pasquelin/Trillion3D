/**
 * The transparent draw copy, named by shape.
 *
 * A blended or transmissive surface is not drawn by the opaque path: the engine holds one copy per
 * placement — the source mesh's own pose, or each row of its instance buffer — and reads it
 * everywhere else through this contract. The engine builds its own record (`blendCopyRecord.ts`);
 * a witness that draws its copies with a host renderer builds a host mesh instead
 * (`blendCopyMesh.ts`), and both satisfy the shape below. What the engine reads of a copy is
 * here and nothing more: the geometry it draws, the surface record it wears, the pose it shares with
 * the engine's world storage, and the source mesh it stands for.
 */

import type { HostAttribute } from '../../session/host/resources.ts'
import type { DrawSource } from '../selection/drawSource.ts'
import type { MatrixElements } from '../../session/host/matrixElements.ts'
import type { PageSurface } from '../pages/surface.ts'
import type { PlacementOf } from '../../placement/rows/rows.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'

/** What the engine reads on a transparent copy. Its `geometry` is the source one, with the index
 *  it draws and its local box on demand; its `matrix` is the engine's world storage for the
 *  source mesh, shared and never written through the copy (`blendCopyRecord.ts`). */
export type BlendCopy = {
  readonly geometry: Geometry & {
    getIndex(): HostAttribute | null
    computeBoundingBox(): void
  }
  /** What the engine reads of the surface: its own record, never the host declaration. A witness
   *  copy is a host mesh and still carries that declaration for the renderer that draws it, but the
   *  contract does not hand it out — `blendCopyMesh.ts` is where it is set, and `PageRec.declaration`
   *  is the one field the closed list of `tests/integration/engine-without-three.test.ts` governs. */
  readonly surface: PageSurface
  /** Rebound onto the same row of a larger buffer when its owner's rows grow (`placement/growth/growth.ts`). */
  matrix: MatrixElements
  /** The row of an instance buffer the copy is posed by, when its mesh is placed by rows: one
   *  copy per row, `matrix` a view on it, skipped while the row is parked. */
  placement?: PlacementOf
  /** True while the host hides the source mesh or one of its ancestors (`placement/hidden.ts`). */
  hidden?: boolean
  readonly frustumCulled: boolean
  renderOrder: number
  /** Set by the engine itself: the source mesh the copy stands for — none for the world DAG's
   *  blended sections (`ClusterRoot.mixed`) —, the attribute flags of the quantized geometry its
   *  pages carry and it reads in place (`FLAG_UV`…, `page/format.ts`), and a paged copy's local box — its
   *  root's (`ClusterRoot.localBox`), what every page it may draw lies in, grown by their grid's
   *  error —, absent on one whose pages deform. */
  readonly userData: {
    pageFlags?: number
    drawSource?: DrawSource
    localBox?: Float64Array
  }
}
