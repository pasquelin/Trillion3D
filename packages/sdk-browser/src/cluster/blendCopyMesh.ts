import type { HostMesh } from '../host/resources.ts';
import type { BlendCopy } from './blendCopyContract.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import type { PageSurface } from '../page/surface.ts';
import {
  placementWorld,
  rowParked,
  type PlacementOf,
  type PlacementRows,
} from '../placement/rows.ts';
import { growPlaced } from '../placement/growth.ts';
import { GraphMesh } from '../host/graph/mesh.ts';

/**
 * The transparent draw copy of an engine that draws its display graph whole — the WebGL2 page
 * path, and the exact witness: a mesh of the engine's own graph, wearing the source mesh's own
 * geometry and surface, drawn by the cluster program's transmission and blend passes
 * (`../webgl/cluster/sceneDraw.ts`). The WebGPU path holds the record of `blendCopyRecord.ts`
 * instead. `collectClusterPages` takes this builder as an option, which
 * `../backend/exact/backend.ts` and `../backend/autonomous/pages.ts` pass.
 *
 * The placement is the ONLY thing that still ties a copy to the scene, and that is where the
 * defect lived: copying a world matrix at prepare time made it a snapshot that no later move —
 * `setTransform`, a moved parent, a direct host write — would correct.
 *
 * The copy therefore reads the engine's world STORAGE for the source mesh
 * (`../host/world/placements.ts`), not a copy of its sixteen numbers: the matrix built here is a
 * container whose `elements` ARE the engine's view, so what a pass rewrites there the copy
 * reads — like the opaque pages of the same mesh, which carry that same pose.
 * `matrixAutoUpdate` stays false, so nothing recomposes this matrix from the copy's local pose —
 * which it does not have, and that is what keeps this container READ-ONLY. The storage is shared
 * both ways: a call that writes THROUGH it — `copy.matrix.copy()`, `.identity()`, `.set()`, the
 * recomposition — would write into the engine's world buffer and corrupt the pose of every page
 * of the same mesh. Nothing on this copy may write its matrix.
 */
export function createBlendCopy(
  mesh: HostMesh,
  renderOrder: number,
  world: MatrixElements,
  surface: PageSurface,
  placement?: PlacementOf,
): BlendCopy {
  const source = mesh as unknown as GraphMesh;
  const copy = new GraphMesh(source.geometry, source.material);
  copy.matrixAutoUpdate = false;
  copy.matrix.elements = world.elements as Float64Array;
  copy.frustumCulled = source.frustumCulled;
  copy.renderOrder = renderOrder;
  copy.userData.sourceMesh = mesh;
  // The engine reads the surface off the record the collection built; the declaration stays on
  // the copy for the ONE reader that needs it, the program that draws it.
  // A copy posed by a row is shown while the row is live: its flag is read here, then again each
  // time the owner reports the row written (`followBlendCopies`).
  copy.visible = !rowParked(placement);
  return Object.assign(copy as unknown as BlendCopy, { surface, placement });
}

/**
 * Rows `from` to `to` of `rows` were written: each copy they pose is shown again while its
 * row is live. True when one of `copies` is posed by `rows`.
 */
export function followBlendCopies(
  copies: BlendCopy[],
  rows: PlacementRows,
  from: number,
  to: number,
) {
  let posed = false;
  for (const copy of copies) {
    if (copy.placement?.rows !== rows) continue;
    posed = true;
    const { index } = copy.placement;
    if (index >= from && index <= to)
      (copy as unknown as GraphMesh).visible = !rowParked(copy.placement);
  }
  return posed;
}

/**
 * Steps 1 and 2 of the growth contract (`growPlaced`) on the copies: those posed by `from`
 * read the same row of `to`, and one parked copy per new row, cloned from the first of them, is
 * appended to `copies` and handed to `add`, the graph that shows them.
 */
export function growBlendCopies(
  copies: BlendCopy[],
  from: PlacementRows,
  to: PlacementRows,
  add: (copy: HostMesh) => void,
) {
  const rebind = (copy: BlendCopy, placement: PlacementOf) => {
    const { elements } = placementWorld(placement.rows, placement.index);
    (copy as unknown as GraphMesh).matrix.elements = elements as Float64Array;
    Object.assign(copy, { placement });
  };
  const clone = (template: BlendCopy, placement: PlacementOf) => {
    const world = placementWorld(placement.rows, placement.index);
    const { sourceMesh } = template.userData;
    return createBlendCopy(sourceMesh!, template.renderOrder, world, template.surface, placement);
  };
  for (const { item } of growPlaced(copies, from, to, rebind, clone)) {
    copies.push(item);
    add(item as unknown as HostMesh);
  }
}
