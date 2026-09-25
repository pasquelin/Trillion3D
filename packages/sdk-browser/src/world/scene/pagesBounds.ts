import { meshes as objects } from '../../scene/meshes.ts';
import type { HostGraphMesh } from '../../host/scene/graphNodes.ts';
import { hostWorldTree } from '../../host/world/tree.ts';
import { primitiveFinder } from '../../scene/primitiveLookup.ts';
import { emptyWorldBox } from '../../host/world/bounds.ts';
import { type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { createBoxTransformLot, type BoxTransformLot } from '../../math/batchRuntime.ts';
import { boxUnionCollector } from '../../math/batchBoxes.ts';
import type { BackendContext } from '../../backend/types.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/**
 * World bounds of the exact pages of a prepared scene: what framing and replication read from
 * an autonomous scene, whose bounds are not those of the host geometries but those the
 * compiler wrote page by page.
 *
 * World matrices are those THE ENGINE computes from local poses, in ONE pass over the subtree
 * (`../../host/world/tree.ts`) as host bounds do: the host scene is not walked for that, and a pose
 * written without composition is taken as-is. Transform and union are the core's, hence the
 * reference's, term for term.
 */

/** A manifest page carries exact bounds, or is only a coarse approximation. */
type ManifestPage = ClusterManifest['primitives'][number]['pages'][number];
const exacte = (item: ManifestPage) => (item.role ?? 'exact') === 'exact';

/** Manifest bounds written flat, six floats from `at`. */
function ecritPage(out: Float64Array, at: number, item: ManifestPage) {
  out[at] = item.min[0];
  out[at + 1] = item.min[1];
  out[at + 2] = item.min[2];
  out[at + 3] = item.max[0];
  out[at + 4] = item.max[1];
  out[at + 5] = item.max[2];
}

/** Exact pages of `source`: the EXACT size the box lot must carry. */
function exactPagesCount(
  source: Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
) {
  const primitiveOf = primitiveFinder(metadata.primitives);
  let n = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (primitive) for (const item of primitive.pages) if (exacte(item)) n++;
  }
  return n;
}

/** The lot that carries these pages, or `null` when there are none: a reservation, not a frame. */
export async function pagesLot(
  source: Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
) {
  const n = exactPagesCount(source, associations, metadata);
  return n ? await createBoxTransformLot(n) : null;
}

/** World bounds of the exact pages of every mesh of `source`, flat `[minX..maxZ]`; `onMissing`
 *  decides what a mesh without a prepared primitive does, and the mesh is skipped once it returns. */
export function pagesBounds(
  source: Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  onMissing: (mesh: HostGraphMesh) => void,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
) {
  const primitiveOf = primitiveFinder(metadata.primitives);
  const union = boxUnionCollector(into, lot, exactPagesCount(source, associations, metadata));
  const mondes = hostWorldTree(source);
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) {
      onMissing(mesh);
      continue;
    }
    // The world matrix is the one the engine computed for this mesh, read once.
    const world = mondes.world(mesh);
    for (const item of primitive.pages)
      if (exacte(item)) {
        ecritPage(union.boxes, union.at, item);
        union.pose(world);
      }
  }
  return union.ferme();
}
