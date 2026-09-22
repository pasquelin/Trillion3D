import * as THREE from 'three';
import { asHostLibrary, type HostMesh } from './hostResources.ts';
import type { BlendCopy } from './blendCopyContract.ts';
import type { MatrixElements } from './matrixElements.ts';
import type { PageSurface } from './pageSurface.ts';
import {
  placementWorld,
  rowParked,
  type PlacementOf,
  type PlacementRows,
} from './placement/placementRows.ts';

/**
 * The transparent draw copy of an engine the HOST renderer draws — a witness, or the WebGL2 page
 * path: a host mesh, because such an engine hands its transparent surfaces back to that renderer.
 * The WebGPU path holds the record of `blendCopyRecord.ts` instead and names no library;
 * `collectClusterPages` takes this builder as an option, which `exactPagesBackend.ts` and
 * `autonomousPages.ts` pass.
 *
 * The placement is the ONLY thing that still ties a copy to the scene, and that is where the
 * defect lived: copying a world matrix at prepare time made it a snapshot that no later move —
 * `setTransform`, a moved parent, a direct host write — would correct.
 *
 * The copy therefore reads the engine's world STORAGE for the source mesh
 * (`hostWorldPlacements.ts`), not a copy of its sixteen numbers: the host matrix built here is
 * a container whose `elements` ARE the engine's view, so what a pass rewrites there the copy
 * reads — like the opaque pages of the same mesh, which carry that same pose.
 * `matrixAutoUpdate` stays false, so Three never recomposes this matrix from the copy's local
 * pose — which it does not have, and that is what keeps this container READ-ONLY. The storage is
 * shared both ways: a host-library call that writes THROUGH it — `copy.matrix.copy()`,
 * `.identity()`, `.set()`, the recomposition — would write into the engine's world buffer and
 * corrupt the pose of every page of the same mesh. Nothing on this copy may write its matrix.
 */
export function createBlendCopy(
  mesh: HostMesh,
  renderOrder: number,
  world: MatrixElements,
  surface: PageSurface,
  placement?: PlacementOf,
): BlendCopy {
  const source = asHostLibrary<THREE.Mesh>(mesh);
  const copy = new THREE.Mesh(source.geometry, source.material);
  copy.matrixAutoUpdate = false;
  copy.matrix = Object.assign(new THREE.Matrix4(), {
    elements: asHostLibrary<number[]>(world.elements),
  });
  copy.frustumCulled = source.frustumCulled;
  copy.renderOrder = renderOrder;
  copy.userData.sourceMesh = mesh;
  // The engine reads the surface off the record the collection built; the host material stays on
  // the copy for the ONE reader that needs it, the host renderer that draws it.
  // A copy posed by a row is shown while the row is live: the host reads the flag the owner
  // writes, so parking or taking the row back needs no write here.
  if (placement)
    Object.defineProperty(copy, 'visible', {
      get(this: { placement?: PlacementOf }) {
        return !rowParked(this.placement);
      },
      configurable: true,
    });
  return Object.assign(copy as unknown as BlendCopy, { surface, placement });
}

/**
 * Steps 1 and 2 of the growth contract (`placementGrowth.ts`) on the host copies: those posed by
 * `from` read the same row of `to`, and one parked copy per new row, cloned from the first of
 * them, is appended to `copies` and handed to `add`, the graph that shows them.
 */
export function growBlendCopies(
  copies: BlendCopy[],
  from: PlacementRows,
  to: PlacementRows,
  add: (copy: HostMesh) => void,
) {
  let template: BlendCopy | undefined;
  for (const copy of copies)
    if (copy.placement?.rows === from) {
      const { index } = copy.placement;
      asHostLibrary<THREE.Mesh>(copy).matrix.elements = asHostLibrary<THREE.Matrix4Tuple>(
        placementWorld(to, index).elements,
      );
      Object.assign(copy, { placement: { rows: to, index } });
      template ??= copy;
    }
  if (!template?.userData.sourceMesh) return;
  const { sourceMesh } = template.userData;
  for (let index = from.capacity; index < to.capacity; index++) {
    const world = placementWorld(to, index);
    const copy = createBlendCopy(sourceMesh, template.renderOrder, world, template.surface, {
      rows: to,
      index,
    });
    copies.push(copy);
    add(asHostLibrary<HostMesh>(copy));
  }
}
