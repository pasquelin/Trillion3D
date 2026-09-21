import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Mesh } from '../../../site/lessons/offline/mesh.ts';

interface BufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target: number;
}
interface Accessor {
  bufferView: number;
  componentType: number;
  type: 'VEC3' | 'VEC4' | 'VEC2' | 'SCALAR';
  count: number;
  min?: number[];
  max?: number[];
}
interface Attributes {
  POSITION: number;
  NORMAL?: number;
  COLOR_0?: number;
  TEXCOORD_0?: number;
}
/** The parts of this recipe's glTF document later code reads or mutates; every other field
 *  (asset, scenes, extensions, nodes, materials) is written once and never read back. */
interface GltfDocument {
  buffers: [{ uri: string; byteLength: number }];
  bufferViews: BufferView[];
  accessors: Accessor[];
  meshes: [{ primitives: [{ attributes: Attributes; indices: number; material: number }] }];
  [field: string]: unknown;
}

/** Write a single authored surface using portable glTF buffers. */
export async function writeGeometry(directory: string, geometry: Mesh) {
  const positions = new Float32Array(geometry.positions),
    indices = new Uint32Array(geometry.indices);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((x, i) => {
    min[i % 3] = Math.min(min[i % 3], x);
    max[i % 3] = Math.max(max[i % 3], x);
  });
  const gltf: GltfDocument = {
    asset: { version: '2.0', generator: 'Web Geometry original offline authoring' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: {
      KHR_lights_punctual: {
        lights: [{ type: 'directional', color: [1, 0.95, 0.88], intensity: 2400 }],
      },
    },
    nodes: [
      { name: 'Authored-surface', mesh: 0 },
      {
        name: 'Authoring-light',
        rotation: [-0.3826834323650898, 0, 0, 0.9238795325112867],
        extensions: { KHR_lights_punctual: { light: 0 } },
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.12, 0.65, 0.52, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.55,
        },
      },
    ],
    buffers: [{ uri: 'geometry.bin', byteLength: positions.byteLength + indices.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, type: 'VEC3', count: positions.length / 3, min, max },
      { bufferView: 1, componentType: 5125, type: 'SCALAR', count: indices.length },
    ],
  };
  const chunks = [Buffer.from(positions.buffer), Buffer.from(indices.buffer)];
  const attributes = gltf.meshes[0].primitives[0].attributes;
  const channels: [
    keyof Omit<Attributes, 'POSITION'>,
    number[] | undefined,
    number,
    Accessor['type'],
  ][] = [
    ['NORMAL', geometry.normals, 3, 'VEC3'],
    ['COLOR_0', geometry.colors, 4, 'VEC4'],
    ['TEXCOORD_0', geometry.uv, 2, 'VEC2'],
  ];
  for (const [key, values, size, type] of channels) {
    if (!values) continue;
    const data = new Float32Array(values),
      bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: gltf.buffers[0].byteLength,
      byteLength: data.byteLength,
      target: 34962,
    });
    attributes[key] = gltf.accessors.length;
    gltf.accessors.push({ bufferView, componentType: 5126, type, count: values.length / size });
    gltf.buffers[0].byteLength += data.byteLength;
    chunks.push(Buffer.from(data.buffer));
  }
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.bin'), Buffer.concat(chunks));
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
}
