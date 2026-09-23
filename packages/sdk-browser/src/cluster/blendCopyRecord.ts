import type { HostMesh } from '../host/resources.ts';
import type { BlendCopy } from './blendCopyContract.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import type { PageSurface } from '../page/surface.ts';
import type { PlacementOf } from '../placement/placementRows.ts';

/** The source mesh a transparent copy stands for, read by shape: the geometry it draws and the
 *  culling the host declared on it. Nothing else of the mesh crosses. */
type BlendSourceMesh = HostMesh & {
  readonly geometry: BlendCopy['geometry'];
  readonly frustumCulled?: boolean;
};

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
 * A witness that draws its transparent surfaces with a host renderer needs a host mesh instead,
 * and builds one on its side (`blendCopyMesh.ts`, injected into `collectClusterPages`).
 */
export function createBlendCopyRecord(
  mesh: HostMesh,
  renderOrder: number,
  world: MatrixElements,
  surface: PageSurface,
  placement?: PlacementOf,
): BlendCopy {
  const source = mesh as BlendSourceMesh;
  return {
    geometry: source.geometry,
    surface,
    matrix: world,
    placement,
    frustumCulled: !!source.frustumCulled,
    renderOrder,
    userData: { sourceMesh: mesh },
  };
}
