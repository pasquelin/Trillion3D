import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createShadowTheatre, theatreMaterials } from './scene.ts';

interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target: number;
}

interface GltfAccessorBounds {
  min?: number[];
  max?: number[];
}

interface GltfAccessor extends GltfAccessorBounds {
  bufferView: number;
  componentType: number;
  type: 'SCALAR' | 'VEC3';
  count: number;
}

interface GltfMaterial {
  name: string;
  doubleSided: true;
  pbrMetallicRoughness: {
    baseColorFactor: readonly [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
  };
}

interface GltfPrimitive {
  material: number;
  attributes: { POSITION: number; NORMAL: number };
  indices: number;
}

interface GltfDocument {
  asset: { version: string; generator: string; copyright: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name: string; mesh: number }[];
  meshes: { name: string; primitives: GltfPrimitive[] }[];
  materials: GltfMaterial[];
  buffers: [{ uri: string; byteLength: number }];
  bufferViews: GltfBufferView[];
  accessors: GltfAccessor[];
}

export async function writeShadowTheatre(directory: string) {
  const gltf: GltfDocument = {
    asset: {
      version: '2.0',
      generator: 'Web Geometry Nocturne Theatre recipe v1',
      copyright: 'Original Web Geometry contributors; repository license',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Nocturne shadow theatre', mesh: 0 }],
    meshes: [{ name: 'Original theatre, curtains and paper actors', primitives: [] }],
    materials: theatreMaterials.map(([name, baseColorFactor, metallicFactor, roughnessFactor]) => ({
      name,
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor, metallicFactor, roughnessFactor },
    })),
    buffers: [{ uri: 'geometry.bin', byteLength: 0 }],
    bufferViews: [],
    accessors: [],
  };
  const chunks: Buffer[] = [];
  const attribute = (values: number[], size: number, indices = false) => {
    const data = indices ? Uint32Array.from(values) : Float32Array.from(values),
      bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: gltf.buffers[0].byteLength,
      byteLength: data.byteLength,
      target: indices ? 34963 : 34962,
    });
    gltf.buffers[0].byteLength += data.byteLength;
    chunks.push(Buffer.from(data.buffer));
    const bounds: GltfAccessorBounds = {};
    if (!indices && size === 3) {
      bounds.min = [0, 1, 2].map((axis) =>
        values.reduce(
          (best, value, index) => (index % 3 === axis ? Math.min(best, value) : best),
          Infinity,
        ),
      );
      bounds.max = [0, 1, 2].map((axis) =>
        values.reduce(
          (best, value, index) => (index % 3 === axis ? Math.max(best, value) : best),
          -Infinity,
        ),
      );
    }
    gltf.accessors.push({
      bufferView,
      componentType: indices ? 5125 : 5126,
      type: size === 1 ? 'SCALAR' : 'VEC3',
      count: values.length / size,
      ...bounds,
    });
    return gltf.accessors.length - 1;
  };
  for (const [material, mesh] of createShadowTheatre())
    gltf.meshes[0].primitives.push({
      material,
      attributes: { POSITION: attribute(mesh.positions, 3), NORMAL: attribute(mesh.normals, 3) },
      indices: attribute(mesh.indices, 1, true),
    });
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  await writeFile(resolve(directory, 'geometry.bin'), Buffer.concat(chunks));
  return gltf;
}
