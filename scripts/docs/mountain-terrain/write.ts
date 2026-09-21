import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Terrain } from './model.ts';

const COLORS = [
  [0.18, 0.25, 0.16, 1],
  [0.29, 0.38, 0.2, 1],
  [0.38, 0.29, 0.2, 1],
  [0.72, 0.7, 0.65, 1],
  [0.04, 0.34, 0.5, 1],
];

/** One glTF buffer view or accessor, as this recipe's flat geometry buffer describes them. */
type BufferView = { buffer: 0; byteOffset: number; byteLength: number; target: number };
type Accessor = {
  bufferView: number;
  componentType: number;
  type: 'VEC3' | 'SCALAR';
  count: number;
  min?: number[];
  max?: number[];
};

export async function writeMountainTerrain(directory: string, geometry: Terrain) {
  const positions = new Float32Array(geometry.positions),
    groups = [...geometry.bands, geometry.river].map((values) => new Uint32Array(values)),
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((value, index) => {
    min[index % 3] = Math.min(min[index % 3], value);
    max[index % 3] = Math.max(max[index % 3], value);
  });
  const bufferViews: BufferView[] = [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
    ],
    accessors: Accessor[] = [
      { bufferView: 0, componentType: 5126, type: 'VEC3', count: positions.length / 3, min, max },
    ],
    chunks = [Buffer.from(positions.buffer)];
  let byteLength = positions.byteLength;
  for (const group of groups) {
    bufferViews.push({
      buffer: 0,
      byteOffset: byteLength,
      byteLength: group.byteLength,
      target: 34963,
    });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5125,
      type: 'SCALAR',
      count: group.length,
    });
    byteLength += group.byteLength;
    chunks.push(Buffer.from(group.buffer));
  }
  const gltf = {
    asset: { version: '2.0', generator: 'Web Geometry original mountain authoring' },
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
        primitives: groups.map((_, material) => ({
          attributes: { POSITION: 0 },
          indices: material + 1,
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
    buffers: [{ uri: 'geometry.bin', byteLength }],
    bufferViews,
    accessors,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.bin'), Buffer.concat(chunks));
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
}
