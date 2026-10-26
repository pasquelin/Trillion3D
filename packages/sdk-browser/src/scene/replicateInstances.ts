import { hostMeshCopy } from './host/scan/graphObjects.ts'
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { boxIsEmpty } from '../../../math/src/geometry/box.ts'
import { madeLot, multiplyLot, type MultiplyLot } from '../geometry/decode/batchRuntime.ts'
import { ENGINE_OWNED } from './host/scan/watch.ts'
import { hostWorldBounds } from './host/world/bounds.ts'
import { meshes } from './meshes.ts'
import { resolveHostSubtree } from './host/world/matrices.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { Group, type Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { copyObject } from '../../../sdk-core/src/world/object/objectCopy.ts'
import type { PageMesh } from '../geometry/pages/pageMesh.ts'

/**
 * Two owned buffers of replication: group pose and placed pose of copy; their products are the
 * lot's. Core reads and writes only `Float64Array` (`packages/math/src/matrix/matrix4.ts`); the
 * matrices a host node carries are plain arrays, copied on input and output.
 */
const groupWorld = new Float64Array(16),
  placed = new Float64Array(16)

/** Each copy's world matrix, as the products `out` hold it. */
function writeWorlds(copies: readonly PageMesh[], out: ArrayLike<number>) {
  for (let i = 0; i < copies.length; i++) {
    const world = copies[i].matrixWorld.elements,
      at = i * MATRIX_VALUES
    for (let k = 0; k < MATRIX_VALUES; k++) world[k] = out[at + k]
  }
}

/** Whether `mesh` is drawn within `source`: it and every node above it, up to `source`, visible. */
function drawnWithin(mesh: Object3D, source: Object3D) {
  for (let node: Object3D | null = mesh; node; node = node === source ? null : node.parent)
    if (!node.visible) return false
  return true
}

/** Replicate transforms only. Geometry, materials and textures remain shared. */
export function replicateInstances(
  source: Object3D,
  associations: Map<Object3D, { meshes?: number; primitives?: number }>,
  count: 1 | 4 | 9 | 12,
  /** Flat world bounds `[minX, minY, minZ, maxX, maxY, maxZ]`, when caller already has them. */
  preparedBounds?: ArrayLike<number>,
  /** Product buffer, when caller reserved it at exact size of copies; else one is made for them. */
  lot?: MultiplyLot | null,
) {
  if (![1, 4, 9, 12].includes(count)) throw new Error('Replica count must be 1, 4, 9 or 12')
  resolveHostSubtree(source)
  if (count === 1) return source
  const bounds = preparedBounds ?? hostWorldBounds(source),
    // Empty box has no size: yields zero on each axis, like reference.
    empty = boxIsEmpty(bounds, 0),
    sizeX = empty ? 0 : bounds[3] - bounds[0],
    sizeZ = empty ? 0 : bounds[5] - bounds[2]
  const [columns, rows] = count === 12 ? [4, 3] : [Math.sqrt(count), Math.sqrt(count)],
    group = new Group(),
    drawn = meshes(source).filter((mesh) => drawnWithin(mesh, source))
  // Products run IN BATCHES by the module's kernel, the one path: in `lot` when it holds exactly one
  // copy per slot, else in one remade at the copies' count and released once read.
  const n = rows * columns * drawn.length,
    own = n > 0 && !lot?.holds(n) ? madeLot(multiplyLot(n), n) : null,
    products = own ?? (n > 0 ? lot : null)
  const copies: PageMesh[] = []
  // Group world pose does not change between copies: copied once.
  copyMatrix4(groupWorld, group.matrixWorld.elements)
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++)
      for (const mesh of drawn) {
        // The flags of the mesh — shadows, far field, draw distance — come with its copy; its pose is set below.
        const copy = copyObject(hostMeshCopy(mesh), mesh, false)
        // This copy belongs to engine: host has never seen it and cannot write it.
        // What traverses graph looking for host write skips it entirely.
        ENGINE_OWNED.add(copy)
        copy.matrixAutoUpdate = false
        copyMatrix4(placed, mesh.matrixWorld.elements)
        placed[12] += (x - (columns - 1) / 2) * sizeX
        placed[14] += (z - (rows - 1) / 2) * sizeZ
        copyMatrix4(copy.matrix.elements, placed)
        // Group and its copies belong to engine: world matrix of copy is product
        // of group matrix by its placed matrix, same one reference calculated by traversing
        // entire group. Core writes it term by term without second pass.
        const at = copies.length * MATRIX_VALUES
        products!.a.set(groupWorld, at)
        products!.b.set(placed, at)
        copies.push(copy)
        const association = associations.get(mesh)
        if (association) associations.set(copy, association)
        group.add(copy)
      }
  if (!products) return group
  products.run()
  writeWorlds(copies, products.out)
  own?.release()
  return group
}
