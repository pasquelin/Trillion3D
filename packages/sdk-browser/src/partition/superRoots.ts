/**
 * WHETHER A CELL NEEDS ITS OBJECTS, OR ITS SUPER-ROOTS DRAW IT.
 *
 * The world DAG continues a cell's object roots into its super-roots (`worldSuperRoots.ts`): the
 * cut draws a super-root while its error projects within the pixel target, and reads the object
 * roots below only once it no longer does. A cell's objects are therefore needed exactly where the
 * cut would descend past its super-roots: where the largest error they replace its object roots at
 * — their `parentError` — projects past the target. The plan reads that choice here, on the cut's
 * own uniforms and its own certified bound (`projectedErrorAt`): a cell's coarse stand-in shows
 * past its loading range, and a page streams only where the cut wants it.
 *
 * The plan sees no view direction (`plan.ts`): the bound is taken where it is largest for a point
 * the frustum shows — on its diagonal (`cellReach`), at the nearest point of the sphere bounding
 * every super-root that replaces the cell's object roots. A super-root kept there moves no shown
 * pixel past the target; where the cut, on a sphere astride the frustum's edge, would still descend,
 * the super-root stands in, as for any page not resident.
 */
import type { WorldRootsCluster } from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { SelectionUniforms } from '../gpu/core/selection.ts'
import { projectedErrorAt } from '../page/selection/projection.ts'
import { sphereUnion } from '../../../math/src/geometry/sphere.ts'
import { distanceVector3, length2 } from '../../../math/src/vector/vector.ts'
import { perspectiveDiagonalSlope } from '../../../math/src/projection/camera.ts'
import type { PartitionOptics } from './plan.ts'

/** Five numbers per cell: the error its object roots are replaced at, then the sphere bounding the
 *  super-roots replacing them, `x, y, z, radius`, world space. */
const SUPER_ROOT_FLOATS = 5

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
  const bounds = new Float64Array(cells * SUPER_ROOT_FLOATS)
  // Not seen yet: no error, an empty sphere (a negative radius, `sphereUnion`).
  for (let at = 0; at < bounds.length; at += SUPER_ROOT_FLOATS) bounds[at + 4] = -1
  for (const { origin, parentError, parentSphere } of clusters) {
    if (origin === null) continue
    const at = cellOf(origin) * SUPER_ROOT_FLOATS
    if (parentError === null || !parentSphere) bounds[at] = Infinity
    else if (bounds[at] !== Infinity) {
      bounds[at] = Math.max(bounds[at], parentError)
      sphereUnion(bounds, at + 1, parentSphere, 0)
    }
  }
  // A cell absent from the DAG, or one an unreplaced object root keeps, is always near.
  for (let at = 0; at < bounds.length; at += SUPER_ROOT_FLOATS)
    if (bounds[at + 4] < 0 || bounds[at] === Infinity)
      bounds.fill(Infinity, at, at + SUPER_ROOT_FLOATS)
  return bounds
}

/** What the cut projects with: its uniforms, and the frustum's diagonal slope (`lensSlope`). */
export type SuperRootLens = Pick<
  SelectionUniforms,
  'pixelScale' | 'pixelError' | 'near' | 'perspective'
> & { slope: number }

/** The slope of the frustum's diagonal `optics` sees, as `cellReach` reads it; 0 for an
 *  orthographic camera, which projects no depth. */
export function lensSlope(optics: PartitionOptics) {
  if (optics.orthographic) return 0
  return perspectiveDiagonalSlope(optics.fov, optics.aspect, optics.zoom || 1)
}

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
  const at = cell * SUPER_ROOT_FLOATS
  const centre = distanceVector3(bounds, eye, at + 1, 0)
  const distance = Math.max(0, centre - bounds[at + 4])
  // On the diagonal a point at `distance` lies at depth `distance·cos θ`, `distance·sin θ` off axis.
  const cos = 1 / length2(1, lens.slope),
    sin = lens.slope * cos
  const focal = Math.max(lens.pixelScale[0], lens.pixelScale[1])
  return projectedErrorAt(
    bounds[at],
    distance * sin,
    distance * cos,
    0,
    1,
    focal,
    lens.near,
    lens.perspective ?? 1,
  )
}
