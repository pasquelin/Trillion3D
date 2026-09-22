/**
 * The transparent draw copy, named by shape.
 *
 * A blended or transmissive surface is not drawn by the opaque path: the engine holds one copy per
 * source mesh, built by `blendCopyMesh.ts` — the boundary that knows the host library — and read
 * everywhere else through this contract. What the engine reads of it is here and nothing more: the
 * geometry it draws, the material it declares, the pose it shares with the engine's world storage,
 * and the source mesh it stands for.
 */

import type { HostAttribute, HostGeometry, HostMaterials, HostMesh } from './hostResources.ts';
import type { MatrixElements } from './matrixElements.ts';

/** The geometry of a copy: the attributes, the index it draws, and its local box on demand. */
export type BlendGeometry = HostGeometry & {
  getIndex(): HostAttribute | null;
  computeBoundingBox(): void;
};

/** What the engine reads on a transparent copy. Its `matrix` is the engine's world storage for
 *  the source mesh, shared and never written through the copy (`blendCopyMesh.ts`). */
export type BlendCopy = {
  readonly geometry: BlendGeometry;
  readonly material: HostMaterials;
  readonly matrix: MatrixElements;
  readonly frustumCulled: boolean;
  renderOrder: number;
  /** Set by the engine itself: the source mesh the copy stands for, and whether it is paged. */
  readonly userData: { pagedBlend?: boolean; sourceMesh?: HostMesh };
};
