import { multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import { setHostPose } from '../../host/pagePose.ts';
import { copyElements } from '../../math/matrixElements.ts';
import type { HostNodeMatrix, MatrixElements } from '../../math/matrixElements.ts';
import type { PageRec, ClusterRoot } from '../../page/selection/selection.ts';

/** The two buffers the composition works in, allocated once: the core multiplies `Float64Array`
 *  alone — one caller passing another container makes its forty-eight accesses polymorphic for
 *  every caller — so a model pose is copied in, and the product copied back out. */
const model = new Float64Array(16),
  product = new Float64Array(16);

/** `pose = transform · model`, sixteen floats in and sixteen floats out: no host library
 *  composes anything here, and the result is the one the reference computes, bit for bit.
 *
 *  `pose` is the mutable shape, `from` the read-only one, and the callers pass fields their own
 *  records declare as `MatrixElements`. TypeScript does not weigh `readonly` when it checks
 *  assignability, so that declaration is a statement of intent the compiler will not enforce:
 *  this function is the ONE writer of those sixteen floats, which is why the rest of the page
 *  path can read them as constants. Widening the records themselves would carry a mutable
 *  matrix through the cut, the rows and the raster, to serve one writer. */
function placeInto(pose: HostNodeMatrix, transform: Float64Array, from: MatrixElements) {
  copyElements(model, from.elements);
  multiplyMatrix4(product, transform, model);
  copyElements(pose.elements, product);
}

/** An instance's own copy of a model pose: storage of the engine's, never a host matrix. */
export function composedPose(transform: Float64Array, from: MatrixElements): MatrixElements {
  const pose = { elements: new Float64Array(16) };
  placeInto(pose, transform, from);
  return pose;
}

/**
 * Re-places an instance: each root `roots[i]`, the clone of `baseRoots[i]`, takes back the
 * transform applied to its model, and the host meshes of its pages follow it — a page carries
 * no pose of its own (#1226).
 */
export function deplaceInstance(
  instance: { roots: ClusterRoot<PageRec>[] },
  baseRoots: readonly ClusterRoot<PageRec>[],
  transform: Float64Array,
) {
  const { roots } = instance;
  for (let i = 0; i < roots.length; i++) {
    const { world, pages } = roots[i];
    placeInto(world, transform, baseRoots[i].world);
    for (const rec of pages) if (rec.mesh) setHostPose(rec.mesh, world);
  }
}
