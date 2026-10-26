/**
 * The host objects a node of the prepared scene carries or is — its camera, its pose — and the
 * loader's rule for naming them, each built as the host loader built it from the same
 * declaration (`./graph.ts` assembles them).
 */
import { RAD2DEG } from '../../../../../math/src/constants.ts'
import type {
  TableCamera,
  TableNode,
} from '../../../../../sdk-core/src/scene/core/tableContracts.ts'
import { Camera } from '../../../../../sdk-core/src/world/camera/camera.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { PageMesh } from '../../../geometry/pages/pageMesh.ts'

/** The characters a node name may not hold, which the loader drops: the ones a path to an
 *  animated property is written with. */
const RESERVED = /[[\].:/]/g
/** The loader's unique-name rule: sanitised, then numbered from the second use on. */
export function uniqueNames() {
  const used = new Set<string>()
  const next = new Map<string, number>()
  return (original: string) => {
    const name = original.replace(/\s/g, '_').replace(RESERVED, '')
    let count = next.get(name) ?? 0,
      candidate = name
    while (used.has(candidate)) candidate = `${name}_${++count}`
    next.set(name, count)
    used.add(candidate)
    return candidate
  }
}

export function camera(declared: TableCamera) {
  const [x, y] = [declared.xmag ?? 0, declared.ymag ?? 0]
  return declared.type === 'perspective'
    ? new Camera('perspective', {
        fov: (declared.yfov ?? 0) * RAD2DEG,
        aspect: declared.aspectRatio || 1,
        near: declared.znear || 1,
        far: declared.zfar || 2e6,
      })
    : new Camera('orthographic', {
        near: declared.znear ?? 0,
        far: declared.zfar ?? 0,
        left: -x,
        right: x,
        top: y,
        bottom: -y,
      })
}

/** Morph weights set on a mesh, the first of them to the first targets; a mesh that morphs
 *  nothing is left alone, as the loader leaves it. */
export function weigh(mesh: PageMesh, weights: readonly number[] | null) {
  if (!mesh.morphTargetInfluences) mesh.updateMorphTargets()
  if (!weights || !mesh.morphTargetInfluences) return
  for (let i = 0; i < weights.length; i++) mesh.morphTargetInfluences[i] = weights[i]
}

/** Sets `node`'s pose from the one declared: a matrix decomposed, or translation, rotation and
 *  scale as they are. */
export function pose(
  node: Object3D,
  declared: Partial<Pick<TableNode, 'matrix' | 'translation' | 'rotation' | 'scale'>>,
) {
  if (declared.matrix) node.applyMatrix4({ elements: declared.matrix })
  else {
    if (declared.translation) node.position.fromArray(declared.translation)
    if (declared.rotation) node.quaternion.fromArray(declared.rotation)
    if (declared.scale) node.scale.fromArray(declared.scale)
  }
}
