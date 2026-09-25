import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createObservatory, observatoryMaterials } from './scene.ts';

interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target: number;
}

interface GltfAccessor {
  bufferView: number;
  componentType: number;
  type: 'SCALAR' | 'VEC3';
  count: number;
  min?: number[];
  max?: number[];
}

interface GltfPrimitive {
  material: number;
  attributes: { POSITION: number; NORMAL: number };
  indices: number;
}

interface GltfMaterial {
  name: string;
  doubleSided: boolean;
  pbrMetallicRoughness: {
    baseColorFactor: [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
  };
}

interface GltfMeshNode {
  name: string;
  mesh: number;
}

interface GltfLightNode {
  name: string;
  rotation: number[];
  extensions: { KHR_lights_punctual: { light: number } };
}

interface GltfDocument {
  asset: { version: string; generator: string; copyright: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: [GltfMeshNode, GltfLightNode];
  extensionsUsed: string[];
  extensions: {
    KHR_lights_punctual: {
      lights: { name: string; type: string; color: number[]; intensity: number }[];
    };
  };
  meshes: [{ name: string; primitives: GltfPrimitive[] }];
  materials: GltfMaterial[];
  buffers: [{ uri: string; byteLength: number }];
  bufferViews: GltfBufferView[];
  accessors: GltfAccessor[];
}

/** Serialize authored surfaces as separate material primitives, with no external resources. */
export async function writeObservatory(directory: string) {
  const gltf: GltfDocument = {
    asset: {
      version: '2.0',
      generator: 'Trillion3D Solstice Court recipe v1',
      copyright: 'Original Trillion3D contributors; repository license',
    },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Solstice Court', mesh: 0 },
      {
        name: 'Late afternoon sun',
        rotation: [-0.36, -0.24, -0.1, 0.895991071384],
        extensions: { KHR_lights_punctual: { light: 0 } },
      },
    ],
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: {
      KHR_lights_punctual: {
        lights: [
          {
            name: 'Late afternoon sun',
            type: 'directional',
            color: [1, 0.88, 0.69],
            intensity: 2400,
          },
        ],
      },
    },
    meshes: [{ name: 'Original observatory masonry and instrument', primitives: [] }],
    materials: observatoryMaterials.map(
      ([name, baseColorFactor, metallicFactor, roughnessFactor]) => ({
        name,
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor, metallicFactor, roughnessFactor },
      }),
    ),
    buffers: [{ uri: 'geometry.bin', byteLength: 0 }],
    bufferViews: [],
    accessors: [],
  };
  const chunks: Buffer[] = [];
  function attribute(values: number[], size: number, index = false) {
    const data = index ? Uint32Array.from(values) : Float32Array.from(values);
    const bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: gltf.buffers[0].byteLength,
      byteLength: data.byteLength,
      target: index ? 34963 : 34962,
    });
    gltf.buffers[0].byteLength += data.byteLength;
    chunks.push(Buffer.from(data.buffer));
    const bounds =
      index || size !== 3
        ? {}
        : {
            min: [0, 1, 2].map((axis) =>
              values.reduce((a, x, i) => (i % 3 === axis ? Math.min(a, x) : a), Infinity),
            ),
            max: [0, 1, 2].map((axis) =>
              values.reduce((a, x, i) => (i % 3 === axis ? Math.max(a, x) : a), -Infinity),
            ),
          };
    gltf.accessors.push({
      bufferView,
      componentType: index ? 5125 : 5126,
      type: size === 1 ? 'SCALAR' : 'VEC3',
      count: values.length / size,
      ...bounds,
    });
    return gltf.accessors.length - 1;
  }
  for (const [material, mesh] of createObservatory().surfaces) {
    gltf.meshes[0].primitives.push({
      material,
      attributes: { POSITION: attribute(mesh.positions, 3), NORMAL: attribute(mesh.normals, 3) },
      indices: attribute(mesh.indices, 1, true),
    });
  }
  const rotation = gltf.nodes[1].rotation,
    length = Math.hypot(...rotation);
  gltf.nodes[1].rotation = rotation.map((value) => value / length);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  await writeFile(resolve(directory, 'geometry.bin'), Buffer.concat(chunks));
  return gltf;
}
