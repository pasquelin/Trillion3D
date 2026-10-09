// A glTF 2.0 scene of the scale laws' generated worlds: its meshes, one material each, nodes that
// place a mesh once, and nodes that place it many times through `EXT_mesh_gpu_instancing` — the
// compiler expands every instance into a placement its partition cuts into cells. One binary
// buffer, every view on a four-byte boundary. Pure: the JSON and the bytes, written by `cook.ts`.
import { bufferPacker } from '../../../scripts/docs/examples/gltf.ts'
import type { MeshData } from './meshes.ts'
import type { Placements } from './scatter.ts'

type Material = { color: [number, number, number]; roughness: number; metalness: number }
export type SceneMesh = { name: string; data: MeshData; material: Material }
/** A node: a mesh placed at `translation`, or as many times as `instances` holds. */
export type SceneNode = {
  mesh: number
  translation?: [number, number, number]
  instances?: Placements
}

/** The scene's glTF JSON and its one binary buffer, named `bin` beside it, packed by the one glTF
 *  packer (`bufferPacker`). */
export function sceneGltf(meshes: readonly SceneMesh[], nodes: readonly SceneNode[], bin: string) {
  const { views, accessors, chunks, accessor, byteLength } = bufferPacker(0)
  const gltfMeshes = meshes.map(({ name, data }, k) => ({
    name,
    primitives: [
      {
        attributes: { POSITION: accessor(data.positions, 3), NORMAL: accessor(data.normals, 3) },
        indices: accessor(data.indices, 1),
        material: k,
      },
    ],
  }))
  const gltfNodes = nodes.map(({ mesh, translation, instances }) => {
    if (!instances) return { mesh, translation: translation ?? [0, 0, 0] }
    const attributes = {
      TRANSLATION: accessor(instances.translations, 3, true),
      ROTATION: accessor(instances.rotations, 4, true),
      SCALE: accessor(instances.scales, 3, true),
    }
    return { mesh, extensions: { EXT_mesh_gpu_instancing: { attributes } } }
  })
  const json = {
    asset: { version: '2.0', generator: 'trillion3d bench laws' },
    extensionsUsed: ['EXT_mesh_gpu_instancing'],
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, k) => k) }],
    nodes: gltfNodes,
    meshes: gltfMeshes,
    materials: meshes.map(({ material: m }) => ({
      pbrMetallicRoughness: {
        baseColorFactor: [...m.color, 1],
        roughnessFactor: m.roughness,
        metallicFactor: m.metalness,
      },
    })),
    accessors,
    bufferViews: views,
    buffers: [{ uri: bin, byteLength: byteLength() }],
  }
  return { json, bytes: new Uint8Array(Buffer.concat(chunks)) }
}
