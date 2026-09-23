import { invertMatrix4, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import type { LightingExperimentRenderState } from './contracts.ts';
import type { ObservationResources } from './resources.ts';
import { createObservationTransforms } from './transforms.ts';
import { hostWorldTree } from '../../host/world/tree.ts';
import { geometryBytes, meshes } from '../../scene/meshes.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';

/** What the engine draws for one observed surface: the host geometry, read where the host
 *  holds it, and an owned placement — no host mesh, no clone. */
type ObservationMesh = {
  geometry: WholeMesh['geometry'];
  matrix: { elements: Float64Array };
  /** Rank of the observed rectangle; -1 for the glossy sphere. */
  surface: number;
  /** Rest pose relative to the base, `base⁻¹ · world`, which each frame recomposes with the base. */
  restTransform: Float64Array;
};

export function createObservationMeshes(
  state: LightingExperimentRenderState,
  resources: ObservationResources,
  source: Parameters<typeof meshes>[0],
) {
  const { surfaceCount, expectedIds } = resources;
  // Every matrix here is an OWNED buffer: the core's product and inverse only read and write
  // `Float64Array`s (`packages/sdk-core/src/math/matrix/matrix4.ts`), and the world poses come from the engine's own tree.
  const copies: ObservationMesh[] = [];
  const { basis, surfaceBasis, sphereBasis } = createObservationTransforms(state);
  let triangles = 0,
    geometryAllocationBytes = 0;
  const sourceMeshes = meshes(source),
    worlds = hostWorldTree(source);
  const indices = sourceMeshes.map((mesh) => {
    const i = expectedIds.indexOf(mesh.name);
    if (i < 0 && mesh.name !== 'glossy_sphere')
      throw new Error(`Unknown source mesh in lighting experiment: ${mesh.name}`);
    return i;
  });
  for (let i = -1; i < surfaceCount; i++)
    if (indices.filter((index) => index === i).length !== 1)
      throw new Error(
        `Lighting experiment requires one source mesh for ${i < 0 ? 'glossy_sphere' : expectedIds[i]}`,
      );
  const counted = new Set<ArrayBufferView>();
  for (let meshIndex = 0; meshIndex < sourceMeshes.length; meshIndex++) {
    const original = sourceMeshes[meshIndex],
      surface = indices[meshIndex],
      geometry = original.geometry;
    const restTransform = new Float64Array(16);
    invertMatrix4(restTransform, surface >= 0 ? surfaceBasis(surface, basis) : sphereBasis(basis));
    multiplyMatrix4(restTransform, restTransform, worlds.world(original));
    copies.push({
      geometry,
      matrix: { elements: new Float64Array(16) },
      surface,
      restTransform,
    });
    triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    geometryAllocationBytes += geometryBytes(geometry, counted);
  }
  const updateTransforms = () => {
    for (const copy of copies) {
      if (copy.surface >= 0) surfaceBasis(copy.surface, basis);
      else sphereBasis(basis);
      multiplyMatrix4(copy.matrix.elements, basis, copy.restTransform);
    }
  };
  updateTransforms();
  return { copies, triangles, geometryAllocationBytes, updateTransforms };
}
export type ObservationMeshes = ReturnType<typeof createObservationMeshes>;
