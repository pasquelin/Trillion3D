import type { DrawSource } from '../page/selection/drawSource.ts'
import type { BlendCopy } from './blendCopyContract.ts'
import type { MatrixElements } from '../host/matrixElements.ts'
import type { PageSurface } from '../page/surface.ts'
import type { PlacementOf } from '../placement/rows.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'

/**
 * The engine's own draw record for a transparent surface.
 *
 * A blended or transmissive surface is not drawn by the opaque path: the engine holds a record
 * of it, in source order, carrying the geometry, the engine's surface record and the pose. The
 * pose is the ONE thing that ties it to the scene, and that is where the defect lived: copying a
 * world matrix at collection time made it a snapshot that no later move — `setTransform`, a moved
 * parent, a direct host write — would correct.
 *
 * The record therefore ALIASES the engine's world STORAGE for the source mesh
 * (`../host/world/placements.ts`), not a copy of its sixteen numbers: what a pass rewrites there the
 * record reads, like the opaque pages of the same mesh, which carry that same pose. Nothing may
 * write through `matrix`: those sixteen floats are the world buffer of every page of that mesh.
 *
 * One place builds a placement's copy, one per blended root, at the open and at a growth alike
 * (`pagedBlendCopiesOf`): its pages draw it, its root deforms it and the proxy meets it by.
 *
 * A witness that draws its transparent surfaces with a host renderer needs a host mesh instead,
 * and builds one on its side (`blendCopyMesh.ts`, injected into `collectClusterPages`).
 */
export function createBlendCopyRecord(
  source: DrawSource | undefined,
  renderOrder: number,
  world: MatrixElements,
  surface: PageSurface,
  placement?: PlacementOf,
): BlendCopy {
  const copy: BlendCopy = {
    // A copy of no source — a world DAG's section — draws its pages alone: no geometry of its own.
    geometry: source?.geometry ?? new Geometry(),
    surface,
    matrix: world,
    placement,
    frustumCulled: source?.frustumCulled ?? true,
    renderOrder,
    userData: { drawSource: source },
  }
  return copy
}
