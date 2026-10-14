import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Terrain } from './model.ts'
import { bufferPacker } from '../gltf.ts'

const COLORS = [
  [0.18, 0.25, 0.16, 1],
  [0.29, 0.38, 0.2, 1],
  [0.38, 0.29, 0.2, 1],
  [0.72, 0.7, 0.65, 1],
  [0.04, 0.34, 0.5, 1],
]

export async function writeMountainTerrain(directory: string, geometry: Terrain) {
  const { views, accessors, chunks, accessor, byteLength } = bufferPacker(0)
  const position = accessor(geometry.positions, 3)
  const groups = [...geometry.bands, geometry.river].map((values) => accessor(values, 1))
  const gltf = {
    asset: { version: '2.0', generator: 'Trillion3D original mountain authoring' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: {
      KHR_lights_punctual: {
        lights: [{ type: 'directional', color: [1, 0.91, 0.8], intensity: 2600 }],
      },
    },
    nodes: [
      { name: 'Eroded mountain watershed', mesh: 0 },
      {
        name: 'Mountain light',
        rotation: [-0.31, 0.19, 0.06, 0.93],
        extensions: { KHR_lights_punctual: { light: 0 } },
      },
    ],
    meshes: [
      {
        primitives: groups.map((indices, material) => ({
          attributes: { POSITION: position },
          indices,
          material,
        })),
      },
    ],
    materials: COLORS.map((baseColorFactor, index) => ({
      name: ['valley soil', 'alpine grass', 'exposed rock', 'summit stone', 'river'][index],
      doubleSided: true,
      ...(index === 4 ? { emissiveFactor: [0.015, 0.12, 0.18] } : {}),
      pbrMetallicRoughness: {
        baseColorFactor,
        metallicFactor: index === 4 ? 0.18 : 0,
        roughnessFactor: index === 4 ? 0.38 : 0.9,
      },
    })),
    buffers: [{ uri: 'geometry.bin', byteLength: byteLength() }],
    bufferViews: views,
    accessors,
  }
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'geometry.bin'), Buffer.concat(chunks))
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf))
}
