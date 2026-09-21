import { mkdir, writeFile } from 'node:fs/promises';
import type { canalCity } from './model.ts';

const materials = {
  brick: [0.48, 0.16, 0.1, 1],
  ochre: [0.64, 0.36, 0.16, 1],
  stone: [0.46, 0.45, 0.4, 1],
  slate: [0.12, 0.16, 0.2, 1],
  glass: [0.04, 0.1, 0.14, 1],
  water: [0.03, 0.2, 0.28, 1],
  metal: [0.13, 0.15, 0.16, 1],
};

interface BufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target: number;
}
interface Accessor {
  bufferView: number;
  componentType: number;
  type: string;
  count: number;
  min?: number[];
  max?: number[];
}
interface Primitive {
  attributes: { POSITION: number };
  indices: number;
  material: number;
}

const aligned = (value: number) => (value + 3) & ~3;
export async function writeCanalCity(directory: string, groups: ReturnType<typeof canalCity>) {
  await mkdir(directory, { recursive: true });
  const chunks: Buffer[] = [],
    bufferViews: BufferView[] = [],
    accessors: Accessor[] = [],
    primitives: Primitive[] = [];
  let byteOffset = 0;
  const push = (bytes: Buffer, target: number) => {
    const offset = aligned(byteOffset);
    if (offset > byteOffset) chunks.push(Buffer.alloc(offset - byteOffset));
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    byteOffset = offset + bytes.length;
    return bufferViews.length - 1;
  };
  for (const [name, geometry] of Object.entries(groups)) {
    const positions = new Float32Array(geometry.positions),
      indices = new Uint32Array(geometry.indices),
      positionView = push(Buffer.from(positions.buffer), 34962),
      indexView = push(Buffer.from(indices.buffer), 34963),
      axes = [0, 1, 2],
      min = axes.map((axis) => Math.min(...geometry.positions.filter((_, i) => i % 3 === axis))),
      max = axes.map((axis) => Math.max(...geometry.positions.filter((_, i) => i % 3 === axis)));
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      type: 'VEC3',
      count: positions.length / 3,
      min,
      max,
    });
    const position = accessors.length - 1;
    accessors.push({
      bufferView: indexView,
      componentType: 5125,
      type: 'SCALAR',
      count: indices.length,
    });
    primitives.push({
      attributes: { POSITION: position },
      indices: accessors.length - 1,
      material: Object.keys(groups).indexOf(name),
    });
  }
  const binary = Buffer.concat(chunks),
    gltf = {
      asset: { version: '2.0', generator: 'Web Geometry original canal city authoring' },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      extensionsUsed: ['KHR_lights_punctual'],
      extensions: {
        KHR_lights_punctual: {
          lights: [{ type: 'directional', color: [1, 0.82, 0.66], intensity: 2600 }],
        },
      },
      nodes: [
        { name: 'Original-canal-district', mesh: 0 },
        {
          name: 'Late-afternoon-light',
          rotation: [-0.31, 0.22, 0.08, 0.92],
          extensions: { KHR_lights_punctual: { light: 0 } },
        },
      ],
      meshes: [{ name: 'Canal-district-material-groups', primitives }],
      materials: Object.entries(materials).map(([name, baseColorFactor]) => ({
        name,
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor,
          metallicFactor: name === 'metal' ? 0.65 : 0.05,
          roughnessFactor: name === 'water' ? 0.24 : 0.72,
        },
        ...(name === 'glass' ? { emissiveFactor: [0.12, 0.19, 0.2] } : {}),
      })),
      buffers: [{ uri: 'geometry.bin', byteLength: binary.length }],
      bufferViews,
      accessors,
    };
  await writeFile(`${directory}/geometry.bin`, binary);
  await writeFile(`${directory}/geometry.gltf`, `${JSON.stringify(gltf)}\n`);
}
