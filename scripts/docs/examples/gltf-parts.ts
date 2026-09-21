import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { examplesDocument, material, surfacesBuffers } from './gltf.ts';
import type { Accessor, BufferView, GltfMaterial, MaterialRow, Primitive } from './gltf-types.ts';
import type { Mesh } from '../shadow-theatre/geometry.ts';

/** One named mesh of a scene: the surfaces of one workshop, by material index. */
export interface ScenePart {
  name: string;
  surfaces: Map<number, Mesh>;
}

/** A lamp the scene file carries, as `KHR_lights_punctual` describes it. */
interface SceneLight {
  type: string;
  color?: readonly number[];
  intensity: number;
  range?: number;
  spot?: { innerConeAngle?: number; outerConeAngle?: number };
}

/** One place in the scene: a part drawn there, a transform, children, or a lamp. */
export interface SceneNode {
  name: string;
  part?: string;
  translation?: readonly number[];
  rotation?: readonly number[];
  scale?: readonly number[];
  children?: readonly SceneNode[];
  light?: SceneLight;
}

interface GltfNode {
  name: string;
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
  extensions?: Record<string, unknown>;
}

interface PartsDocument {
  asset: { version: string; generator: string; copyright: string };
  scene: number;
  scenes: { name: string; nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { name: string; primitives: Primitive[] }[];
  materials: GltfMaterial[];
  buffers: { uri: string; byteLength: number }[];
  bufferViews: BufferView[];
  accessors: Accessor[];
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
  images?: { uri: string }[];
  textures?: { source: number }[];
}

/** The placed fields a node rounds before it is written. */
const PLACED = ['translation', 'rotation', 'scale'] as const;

/**
 * Writes a scene of named parts as `geometry.gltf` in `directory`. Each part — `{ name,
 * surfaces }` from a workshop — becomes one mesh in its own `<part>.bin`; `nodes` place it as
 * many times as the scene needs, `{ name, part?, translation?, rotation?, scale?, children?,
 * light? }` each: a node the engine moves by name, an instance the compiler places once and
 * draws everywhere, a lamp the file carries (`KHR_lights_punctual`). `images` names the PNG
 * files beside the glTF, one texture each, that a material row's extra field may index; `uv`
 * writes the workshop's texture coordinates with every part.
 */
export async function writePartsGltf(
  directory: string,
  name: string,
  materials: readonly MaterialRow[],
  parts: readonly ScenePart[],
  nodes: readonly SceneNode[],
  options: { images?: readonly string[]; uv?: boolean } = {},
) {
  const { images = [], uv = images.length > 0 } = options;
  const gltf: PartsDocument = {
    ...examplesDocument(),
    scenes: [{ name, nodes: [] }],
    nodes: [],
    meshes: [],
    materials: materials.map(material),
    buffers: [],
    bufferViews: [],
    accessors: [],
  };
  const files: [string, Buffer][] = [];
  parts.forEach((part, index) => {
    const built = surfacesBuffers(
      part.surfaces,
      index,
      gltf.bufferViews.length,
      gltf.accessors.length,
      0,
      uv,
    );
    gltf.buffers.push({ uri: `${part.name}.bin`, byteLength: built.byteLength });
    gltf.bufferViews.push(...built.views);
    gltf.accessors.push(...built.accessors);
    gltf.meshes.push({ name: part.name, primitives: built.primitives });
    files.push([`${part.name}.bin`, Buffer.concat(built.chunks)]);
  });
  const lights: SceneLight[] = [];
  const place = (node: SceneNode): number => {
    const index = gltf.nodes.length,
      entry: GltfNode = { name: node.name };
    if (node.part !== undefined) {
      entry.mesh = parts.findIndex((part) => part.name === node.part);
      if (entry.mesh < 0) throw new Error(`Unknown part: ${node.part}`);
    }
    // Four decimals: a tenth of a millimetre, and a node list of ten thousand stays readable.
    for (const field of PLACED) {
      const values = node[field];
      if (values) entry[field] = values.map((value) => Number(value.toFixed(4)));
    }
    if (node.light)
      entry.extensions = { KHR_lights_punctual: { light: lights.push(node.light) - 1 } };
    gltf.nodes.push(entry);
    if (node.children) entry.children = node.children.map(place);
    return index;
  };
  gltf.scenes[0].nodes = nodes.map(place);
  // A reader activates an extension it finds in `extensionsUsed` alone.
  const used = new Set(gltf.materials.flatMap((entry) => Object.keys(entry.extensions ?? {})));
  if (lights.length) {
    used.add('KHR_lights_punctual');
    gltf.extensions = { KHR_lights_punctual: { lights } };
  }
  if (used.size) gltf.extensionsUsed = [...used];
  if (images.length) {
    gltf.images = images.map((uri) => ({ uri }));
    gltf.textures = images.map((_, source) => ({ source }));
  }
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  for (const [file, bytes] of files) await writeFile(resolve(directory, file), bytes);
}

/** The quaternion of a rotation of `angle` radians about the unit `axis`, as glTF writes it. */
export const rotation = (axis: readonly number[], angle: number): number[] => [
  ...axis.map((value) => value * Math.sin(angle / 2)),
  Math.cos(angle / 2),
];
