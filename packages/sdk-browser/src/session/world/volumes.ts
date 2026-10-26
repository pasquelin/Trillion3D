import { firstMaterial } from '../../../../sdk-core/src/contracts/material.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { SceneFogVolume } from '../../../../sdk-core/src/scene/volume/contracts.ts'
import { drawnCount } from '../../../../sdk-core/src/world/math/box3.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { isInstancedNode, isVolumeNode } from '../../scene/host/graph/kinds.ts'

/** The fog volume calls of a session (`api/fogVolumeApi.ts`) the world writes its objects through. */
type VolumeApi = {
  addFogVolume(volume: SceneFogVolume): void
  setFogVolume(id: string, patch: Partial<Omit<SceneFogVolume, 'id'>>): void
  removeFogVolume(id: string): void
}

/** Whether `node` and every node above it is visible: an object of a hidden branch is not in the
 *  volume. */
function shown(node: Object3D | null): boolean {
  for (let at = node; at; at = at.parent) if (!at.visible) return false
  return true
}

/** The world matrix of each placement of an instanced mesh, `scratch` held between them. */
const placed = new Float64Array(16),
  composed = new Float64Array(16)

/** The records a mesh with a volume material is, one for the mesh and one for each placement of an
 *  instanced one, or none while its geometry holds no vertex or its material gives an output out
 *  of its range — said once through `refused`. */
function recordsOf(mesh: Mesh, ids: string[], refused: (mesh: Mesh, error: unknown) => void) {
  const geometry = mesh.geometry
  const box = geometry.boundingBox ?? geometry.computeBoundingBox()
  if (box.min.x > box.max.x) return []
  mesh.updateWorldMatrix(true, false)
  try {
    const worn = firstMaterial(mesh.material) as Material
    const material = worn.volumeOutputs()
    const instanced = isInstancedNode(mesh)
    return ids.map((id, at) => {
      let matrix = mesh.matrixWorld.elements
      if (instanced) {
        placed.set(mesh.instanceMatrix.array.subarray(16 * at, 16 * at + 16))
        matrix = multiplyMatrix4(composed, matrix, placed)
      }
      return {
        id,
        shape: 'box' as const,
        matrix: [...matrix],
        boundsMin: [box.min.x, box.min.y, box.min.z] as const,
        boundsMax: [box.max.x, box.max.y, box.max.z] as const,
        material,
        graph: worn.graph,
      }
    })
  } catch (error) {
    refused(mesh, error)
    return []
  }
}

/**
 * Keeps a session's store of the objects voxelised into the fog's volume equal to the meshes of a
 * scene that wear a volume material (`material.volume`): each mesh that is shown is one object, an
 * instanced mesh one object a placement it draws (`count`), its box the bounds of its geometry
 * placed by its world matrix (and its placement's), its material the outputs of its material. A
 * mesh that is hidden, loses its material or leaves the scene is removed, and so is a placement an
 * instanced mesh draws no more. `meshes` is the set the world keeps (`members.volumes`); the store
 * compares what it is given with what it holds, so a frame in which nothing moved changes nothing.
 */
export function createWorldVolumes(
  meshes: ReadonlySet<Mesh>,
  refused: (mesh: Mesh, error: unknown) => void,
) {
  /** The identifiers each mesh holds in the store, one a placement. */
  const ids = new Map<Mesh, string[]>()
  const said = new WeakSet<Mesh>()
  let next = 1
  const report = (mesh: Mesh, error: unknown) => {
    if (!said.has(mesh)) refused(mesh, error)
    said.add(mesh)
  }
  /** `mesh`'s records written, the placements it draws no more removed; its identifiers kept. */
  const write = (api: VolumeApi, mesh: Mesh, wanted: number) => {
    const held = ids.get(mesh) ?? []
    const fresh = held.length
    while (held.length < wanted) held.push(`world-fog-volume-${next++}`)
    const records = recordsOf(mesh, held.slice(0, wanted), report)
    // A mesh that gives no record holds none: what it held is removed.
    const kept = records.length ? wanted : 0
    records.forEach((record, at) => {
      if (at < fresh) api.setFogVolume(record.id, record)
      else api.addFogVolume(record)
    })
    for (const id of held.slice(kept, fresh)) api.removeFogVolume(id)
    held.length = kept
    if (kept) ids.set(mesh, held)
    else ids.delete(mesh)
  }
  return {
    /** The session changed: its store starts empty. */
    reset() {
      ids.clear()
    },
    /** Writes the shown meshes into the store, removes those it holds no more. */
    sync(api: VolumeApi) {
      for (const mesh of meshes)
        write(api, mesh, isVolumeNode(mesh) && shown(mesh) ? placements(mesh) : 0)
      for (const mesh of [...ids.keys()]) if (!meshes.has(mesh)) write(api, mesh, 0)
    },
  }
}

/** How many objects `mesh` is in the volume: one, or one a placement an instanced mesh draws. */
const placements = (mesh: Mesh) => (isInstancedNode(mesh) ? drawnCount(mesh) : 1)
