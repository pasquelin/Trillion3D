import type { HostBoundedNode } from '../scene/graphNodes.ts';
import { BOX_VALUES, boxEmpty } from '../../../../sdk-core/src/index.ts';
import { boxUnionCollector } from '../../math/batchBoxes.ts';
import { createBoxTransformLot, type BoxTransformLot } from '../../math/batchRuntime.ts';
import { hostWorldTree } from './tree.ts';
import type { HierarchyLot } from '../../math/batchHierarchy.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/**
 * World bounds of a host subtree, computed by the core on flat boxes.
 *
 * This is the reference's `Box3.setFromObject` rule, term for term: every object of the subtree
 * that carries a geometry gives its local box, transformed by its world matrix, and the union of
 * the eight corners is taken. The world matrix is the one THE ENGINE computes from the host's
 * local poses (`tree.ts`), never the one its library composes. An object that holds its
 * own box — instanced meshes — prefers it to that of its geometry, as the reference does. The
 * transform and the union are those of `packages/sdk-core/src/math/primitives/box.ts`: the same bits, empty boxes, NaN and
 * infinities included.
 */

/** An empty flat box, ready for a union: low bounds at `+∞`, high at `−∞`. */
export function emptyWorldBox() {
  const box = new Float64Array(BOX_VALUES);
  boxEmpty(box, 0);
  return box;
}

/**
 * LOCAL box that `object` carries, or `undefined` if it has none. As in the reference, the
 * object's box wins over that of its geometry, and a missing box is computed on demand — it is
 * a derivative of the vertices the host owns, not a transform.
 */
function localBoxOf(object: HostBoundedNode) {
  if (object.boundingBox !== undefined) {
    if (object.boundingBox === null) object.computeBoundingBox?.();
    return object.boundingBox ?? undefined;
  }
  const geometry = object.geometry;
  if (!geometry) return undefined;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  return geometry.boundingBox ?? undefined;
}

/** Bounded objects of the subtree: the EXACT size the box lot must carry. */
function bornes(source: Object3D) {
  let n = 0;
  source.traverse((object) => {
    if (localBoxOf(object as HostBoundedNode)) n++;
  });
  return n;
}

/** Lot that carries this subtree's boxes, or `null` when it has none. */
export async function hostBoundsLot(source: Object3D) {
  const n = bornes(source);
  return n ? await createBoxTransformLot(n) : null;
}

/**
 * Union of the world bounds of `source` and its descendants into `into`, which must arrive empty
 * or already started. The subtree's world matrices are computed once, in one pass: `worlds` is
 * the hierarchy buffer reserved for it, and without it the pass runs on the core tree. When
 * `lot` carries exactly these boxes, they go AS A LOT through the governor; otherwise each
 * goes alone, by the same `boxTransform` and on the same inputs.
 */
export function hostWorldBounds(
  source: Object3D,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
  worlds?: HierarchyLot | null,
) {
  const mondes = hostWorldTree(source, worlds);
  const union = boxUnionCollector(into, lot, bornes(source));
  source.traverse((object) => {
    const box = localBoxOf(object as HostBoundedNode);
    if (!box) return;
    const out = union.boxes,
      at = union.at;
    out[at] = box.min.x;
    out[at + 1] = box.min.y;
    out[at + 2] = box.min.z;
    out[at + 3] = box.max.x;
    out[at + 4] = box.max.y;
    out[at + 5] = box.max.z;
    union.pose(mondes.world(object));
  });
  return union.ferme();
}
