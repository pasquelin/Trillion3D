// A glTF 2.0 scene of the scale laws' generated worlds: its meshes, one material each, nodes that
// place a mesh once, and nodes that place it many times through `EXT_mesh_gpu_instancing` — the
// compiler expands every instance into a placement its partition cuts into cells. One binary
// buffer, every view on a four-byte boundary. Pure: the JSON and the bytes, written by `cook.ts`.
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

const FLOAT = 5126,
  UINT = 5125,
  ARRAY = 34962,
  ELEMENTS = 34963

/** The scene's glTF JSON and its one binary buffer, named `bin` beside it. */
export function sceneGltf(meshes: readonly SceneMesh[], nodes: readonly SceneNode[], bin: string) {
  const chunks: Uint8Array[] = []
  const bufferViews: object[] = [],
    accessors: object[] = []
  let length = 0
  /** A view of `array`'s bytes and an accessor of `count` elements of `type` over it. */
  const accessor = (
    array: Float32Array | Uint32Array,
    type: string,
    count: number,
    target?: number,
    bounds?: { min: number[]; max: number[] },
  ) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target })
    chunks.push(bytes)
    length += bytes.length
    const pad = (4 - (length % 4)) % 4
    if (pad) chunks.push(new Uint8Array(pad))
    length += pad
    const componentType = array instanceof Float32Array ? FLOAT : UINT
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count, type, ...bounds })
    return accessors.length - 1
  }
  const gltfMeshes = meshes.map(({ name, data }, k) => {
    const vertices = data.positions.length / 3
    const position = accessor(data.positions, 'VEC3', vertices, ARRAY, boundsOf(data.positions))
    const normal = accessor(data.normals, 'VEC3', vertices, ARRAY)
    const indices = accessor(data.indices, 'SCALAR', data.indices.length, ELEMENTS)
    return {
      name,
      primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, material: k }],
    }
  })
  const gltfNodes = nodes.map(({ mesh, translation, instances }) => {
    if (!instances) return { mesh, translation: translation ?? [0, 0, 0] }
    const count = instances.scales.length / 3
    const attributes = {
      TRANSLATION: accessor(instances.translations, 'VEC3', count),
      ROTATION: accessor(instances.rotations, 'VEC4', count),
      SCALE: accessor(instances.scales, 'VEC3', count),
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
    bufferViews,
    buffers: [{ uri: bin, byteLength: length }],
  }
  const bytes = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) bytes.set(chunk, (at += chunk.length) - chunk.length)
  return { json, bytes }
}

/** The per-axis bounds of a list of points, as an accessor declares them. */
function boundsOf(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i])
    max[i % 3] = Math.max(max[i % 3], positions[i])
  }
  return { min, max }
}
