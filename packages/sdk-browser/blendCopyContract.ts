/**
 * The transparent draw copy, named by shape.
 *
 * A blended or transmissive surface is not drawn by the opaque path: the engine holds one copy per
 * source mesh and reads it everywhere else through this contract. The engine builds its own record
 * (`blendCopyRecord.ts`); a witness that draws its copies with a host renderer builds a host mesh
 * instead (`blendCopyMesh.ts`), and both satisfy the shape below. What the engine reads of a copy is
 * here and nothing more: the geometry it draws, the surface record it wears, the pose it shares with
 * the engine's world storage, and the source mesh it stands for.
 */

import type { HostAttribute, HostGeometry, HostMesh } from './hostResources.ts';
import type { MatrixElements } from './matrixElements.ts';
import type { PageSurface } from './pageSurface.ts';

/** What the engine reads on a transparent copy. Its `geometry` is the source one, with the index
 *  it draws and its local box on demand; its `matrix` is the engine's world storage for the
 *  source mesh, shared and never written through the copy (`blendCopyRecord.ts`). */
export type BlendCopy = {
  readonly geometry: HostGeometry & {
    getIndex(): HostAttribute | null;
    computeBoundingBox(): void;
  };
  /** What the engine reads of the surface: its own record, never the host declaration. A witness
   *  copy is a host mesh and still carries that declaration for the renderer that draws it, but the
   *  contract does not hand it out — `blendCopyMesh.ts` is where it is set, and `PageRec.declaration`
   *  is the one field the closed list of `test/integration/moteur-sans-three.test.ts` governs. */
  readonly surface: PageSurface;
  readonly matrix: MatrixElements;
  readonly frustumCulled: boolean;
  renderOrder: number;
  /** Set by the engine itself: the source mesh the copy stands for, and whether it is paged. */
  readonly userData: { pagedBlend?: boolean; sourceMesh?: HostMesh };
};
