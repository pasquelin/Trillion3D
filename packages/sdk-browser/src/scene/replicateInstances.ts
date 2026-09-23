import type { HostNode } from '../host/resources.ts';
import type { HostGraphMesh, HostGraphNode } from '../host/scene/graphNodes.ts';
import { hostGroup, hostMeshCopy } from '../host/scene/graphObjects.ts';
import { MATRIX_VALUES, boxIsEmpty, multiplyMatrix4 } from '../../../sdk-core/src/index.ts';
import type { MultiplyLot } from '../math/batchRuntime.ts';
import { ENGINE_OWNED } from '../host/scene/watch.ts';
import { hostWorldBounds } from '../host/world/bounds.ts';
import { meshes as objects } from './meshes.ts';
import { resolveHostSubtree } from '../host/world/matrices.ts';
import { copyElements } from '../math/matrixElements.ts';

/**
 * Three owned buffers of replication: group pose, placed pose of copy,
 * and their product. Core reads and writes only `Float64Array` (`packages/sdk-core/src/math/matrix/matrix4.ts`); the matrices
 * a host node carries are plain arrays, copied on input and output.
 */
const groupWorld = new Float64Array(16),
  placed = new Float64Array(16),
  product = new Float64Array(16);

/** Replicate transforms only. Geometry, materials and textures remain shared. */
export function replicateInstances(
  source: HostGraphNode,
  associations: Map<HostNode, { meshes?: number; primitives?: number }>,
  count: 1 | 4 | 9 | 12,
  /** Flat world bounds `[minX, minY, minZ, maxX, maxY, maxZ]`, when caller already has them. */
  preparedBounds?: ArrayLike<number>,
  /** Product buffer, when caller reserved it at exact size of copies. */
  lot?: MultiplyLot | null,
) {
  if (![1, 4, 9, 12].includes(count)) throw new Error('Replica count must be 1, 4, 9 or 12');
  resolveHostSubtree(source);
  if (count === 1) return source;
  const bounds = preparedBounds ?? hostWorldBounds(source),
    // Empty box has no size: yields zero on each axis, like reference.
    empty = boxIsEmpty(bounds, 0),
    sizeX = empty ? 0 : bounds[3] - bounds[0],
    sizeZ = empty ? 0 : bounds[5] - bounds[2];
  const [columns, rows] = count === 12 ? [4, 3] : [Math.sqrt(count), Math.sqrt(count)],
    group = hostGroup(),
    meshes = objects(source);
  // Products dispatched IN BATCHES by governor when buffer holds exactly one copy per slot.
  // Otherwise each product runs in place, by same `multiplyMatrix4` on same inputs: same bits.
  const enLot = lot?.holds(rows * columns * meshes.length) ? lot : null;
  const copies: HostGraphMesh[] = [];
  // Group world pose does not change between copies: copied once.
  copyElements(groupWorld, group.matrixWorld.elements);
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++)
      for (const mesh of meshes) {
        const copy = hostMeshCopy(mesh);
        // This copy belongs to engine: host has never seen it and cannot write it.
        // What traverses graph looking for host write skips it entirely.
        copy.userData[ENGINE_OWNED] = true;
        copy.matrixAutoUpdate = false;
        copyElements(placed, mesh.matrixWorld.elements);
        placed[12] += (x - (columns - 1) / 2) * sizeX;
        placed[14] += (z - (rows - 1) / 2) * sizeZ;
        copyElements(copy.matrix.elements, placed);
        // Group and its copies belong to engine: world matrix of copy is product
        // of group matrix by its placed matrix, same one reference calculated by traversing
        // entire group. Core writes it term by term without second pass.
        if (enLot) {
          const at = copies.length * MATRIX_VALUES;
          enLot.a.set(groupWorld, at);
          enLot.b.set(placed, at);
          copies.push(copy);
        } else
          copyElements(copy.matrixWorld.elements, multiplyMatrix4(product, groupWorld, placed));
        const association = associations.get(mesh);
        if (association) associations.set(copy, association);
        group.add(copy);
      }
  if (!enLot) return group;
  enLot.run();
  for (let i = 0; i < copies.length; i++) {
    const world = copies[i].matrixWorld.elements,
      at = i * MATRIX_VALUES;
    for (let k = 0; k < MATRIX_VALUES; k++) world[k] = enLot.out[at + k];
  }
  return group;
}
