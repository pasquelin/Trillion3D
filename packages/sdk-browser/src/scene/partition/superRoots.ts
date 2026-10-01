/**
 * WHETHER A CELL NEEDS ITS OBJECTS, OR ITS SUPER-ROOTS DRAW IT (#1332).
 *
 * The world DAG continues a cell's object roots into its super-roots (`worldSuperRoots.ts`): the
 * cut draws a super-root while its error projects within the pixel target, and reads the object
 * roots below only once it no longer does. A cell's objects are therefore needed exactly where the
 * cut would descend past its super-roots: where the largest error they replace its object roots at
 * — their `parentError` — projects past the target. The plan reads that choice here, on the cut's
 * own uniforms and its own certified bound (`projectedErrorAt`), as World Partition shows a cell's
 * HLOD past its loading range, and Nanite streams a page only where the cut wants it.
 *
 * The plan sees no view direction (`plan.ts`): the bound is taken where it is largest for a point
 * the frustum shows — on its diagonal (`cellReach`), at the nearest point of the sphere bounding
 * every super-root that replaces the cell's object roots. A super-root kept there moves no shown
 * pixel past the target; where the cut, on a sphere astride the frustum's edge, would still descend,
 * the super-root stands in, as for any page not resident.
 */
import type { WorldRootsCluster } from '../../../../sdk-core/src/manifest/worldRoots.ts';
import type { SelectionUniforms } from '../../gpu/core/selection.ts';
import { projectedErrorAt } from '../../page/selection/projection.ts';

/** Five numbers per cell: the error its object roots are replaced at, then the sphere bounding the
 *  super-roots replacing them, `x, y, z, radius`, world space. */
export const SUPER_ROOT_FLOATS = 5;

/**
 * Each of `cells` cells' super-root bound, from the world DAG's `clusters` (`world-roots.dag`), an
 * object root's cell read through `cellOf` its `origin`. A cell with an object root nothing
 * replaces (a kept node, a primitive without a DAG), or with none in the DAG, always needs its
 * objects: its error is infinite.
 */
export function cellSuperRoots(
  clusters: readonly WorldRootsCluster[],
  cellOf: (origin: number) => number,
  cells: number,
) {
  const bounds = new Float64Array(cells * SUPER_ROOT_FLOATS).fill(Infinity);
  // Each cell's box around the replacing spheres, `min` then `max`, empty to start.
  const box = new Float64Array(cells * 6);
  for (let cell = 0; cell < cells; cell++)
    box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], cell * 6);
  const seen = new Uint8Array(cells),
    error = new Float64Array(cells);
  const objectRoots = clusters.filter((cluster) => cluster.origin !== null);
  for (const { origin, parentError, parentSphere } of objectRoots) {
    const cell = cellOf(origin!);
    seen[cell] = 1;
    if (parentError === null || !parentSphere) {
      error[cell] = Infinity;
      continue;
    }
    error[cell] = Math.max(error[cell], parentError);
    for (let axis = 0; axis < 3; axis++) {
      box[cell * 6 + axis] = Math.min(box[cell * 6 + axis], parentSphere[axis] - parentSphere[3]);
      box[cell * 6 + 3 + axis] = Math.max(
        box[cell * 6 + 3 + axis],
        parentSphere[axis] + parentSphere[3],
      );
    }
  }
  for (let cell = 0; cell < cells; cell++) {
    if (!seen[cell] || error[cell] === Infinity) continue;
    const at = cell * SUPER_ROOT_FLOATS,
      b = cell * 6;
    bounds[at] = error[cell];
    for (let axis = 0; axis < 3; axis++)
      bounds[at + 1 + axis] = (box[b + axis] + box[b + 3 + axis]) / 2;
    bounds[at + 4] = 0;
  }
  // The radius: every replacing sphere inside, centre distance plus its own radius.
  for (const { origin, parentSphere } of objectRoots) {
    const at = cellOf(origin!) * SUPER_ROOT_FLOATS;
    if (!parentSphere || bounds[at] === Infinity) continue;
    const away = Math.hypot(
      parentSphere[0] - bounds[at + 1],
      parentSphere[1] - bounds[at + 2],
      parentSphere[2] - bounds[at + 3],
    );
    bounds[at + 4] = Math.max(bounds[at + 4], away + parentSphere[3]);
  }
  return bounds;
}

/** What the cut projects with: its uniforms, and the frustum's diagonal slope (`cellReach`). */
export type SuperRootLens = Pick<
  SelectionUniforms,
  'pixelScale' | 'pixelError' | 'near' | 'perspective'
> & { slope: number };

/**
 * The largest error, in pixels, `cell`'s super-roots move a point the frustum shows, seen from
 * `eye` (world space): their sphere's nearest point put on the frustum's diagonal, through the
 * cut's certified bound. Past the lens's `pixelError` the cut descends to the cell's objects.
 */
export function cellSuperRootError(
  bounds: Float64Array,
  cell: number,
  eye: ArrayLike<number>,
  lens: SuperRootLens,
) {
  const at = cell * SUPER_ROOT_FLOATS;
  const centre = Math.hypot(
    bounds[at + 1] - eye[0],
    bounds[at + 2] - eye[1],
    bounds[at + 3] - eye[2],
  );
  const distance = Math.max(0, centre - bounds[at + 4]);
  // On the diagonal a point at `distance` lies at depth `distance·cos θ`, `distance·sin θ` off axis.
  const cos = 1 / Math.sqrt(1 + lens.slope * lens.slope),
    sin = lens.slope * cos;
  const focal = Math.max(lens.pixelScale[0], lens.pixelScale[1]);
  return projectedErrorAt(
    bounds[at],
    distance * sin,
    distance * cos,
    0,
    1,
    focal,
    lens.near,
    lens.perspective ?? 1,
  );
}
