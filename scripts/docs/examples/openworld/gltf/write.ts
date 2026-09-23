/**
 * Writes one piece of the open world as `<fileName>.gltf` + `<fileName>.bin`: every `PropMesh`
 * once, a node per `Instance` that references it (the engine shares one mesh's pages across all
 * of its nodes), one material per surface name, `KHR_lights_punctual` lamps on nodes of their
 * own. Everything streams to disk: the JSON's node list is written in slices, the binary chunk
 * in a few megabytes at a time. Plain float positions and 32-bit indices: the compiler refuses
 * `KHR_mesh_quantization`. Texture coordinates are written for the parts that carry them, and
 * each base colour image a surface names is written once, as a PNG beside the glTF.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Instance, LampLight, PropMesh } from '../plan/contract.ts';
import { smoothNormals } from '../props/geometry.ts';
import { writeImages, type Image } from './images.ts';
import { binaryWriter, fileSink, type Sink } from './stream.ts';
import { instanceNode, lightTable, materialTable, type GltfNode } from './tables.ts';

export type WorldPiece = {
  meshes: readonly PropMesh[];
  instances: readonly Instance[];
  lights: readonly LampLight[];
  /** The images surfaces name, by file name. */
  images?: ReadonlyMap<string, Image>;
};

/** Nodes serialised per slice: the JSON is never one string of the whole world. */
const NODES_PER_SLICE = 4096;

/** Writes `items` as a JSON array body, `slice` of them per write. */
async function writeArray<T>(sink: Sink, count: number, item: (i: number) => T) {
  for (let start = 0; start < count; start += NODES_PER_SLICE) {
    const end = Math.min(count, start + NODES_PER_SLICE),
      parts: string[] = [];
    for (let i = start; i < end; i++) parts.push(JSON.stringify(item(i)));
    await sink.write((start ? ',' : '') + parts.join(','));
  }
}

/** Writes the piece under `directory`; returns the file names and what they hold. */
export async function writeWorldGltf(directory: string, fileName: string, piece: WorldPiece) {
  await mkdir(directory, { recursive: true });
  const binName = `${fileName}.bin`,
    bin = await fileSink(resolve(directory, binName)),
    binary = binaryWriter(bin),
    materials = materialTable(),
    meshIndex = new Map<string, number>(),
    meshes: { name: string; primitives: object[] }[] = [];
  let triangles = 0;
  for (const mesh of piece.meshes) {
    if (meshIndex.has(mesh.id)) throw new Error(`mesh "${mesh.id}" is given twice`);
    const primitives: object[] = [];
    for (const part of mesh.parts) {
      const POSITION = await binary.vec3(part.positions, true),
        NORMAL = await binary.vec3(
          part.normals ?? smoothNormals(part.positions, part.indices),
          false,
        ),
        TEXCOORD_0 = part.uvs ? await binary.vec2(part.uvs) : undefined,
        indices = await binary.indices(part.indices);
      primitives.push({
        attributes: { POSITION, NORMAL, ...(TEXCOORD_0 === undefined ? {} : { TEXCOORD_0 }) },
        indices,
        material: materials.of(part.surface),
      });
      triangles += part.indices.length / 3;
    }
    meshIndex.set(mesh.id, meshes.push({ name: mesh.id, primitives }) - 1);
  }
  await bin.close();

  const lamps = lightTable(),
    instanceCount = piece.instances.length,
    nodeCount = instanceCount + piece.lights.length;
  const node = (i: number): GltfNode => {
    if (i >= instanceCount) return lamps.node(piece.lights[i - instanceCount]);
    const instance = piece.instances[i],
      mesh = meshIndex.get(instance.prop);
    if (mesh === undefined) throw new Error(`instance of unknown prop "${instance.prop}"`);
    return instanceNode(instance, mesh);
  };

  const gltf = await fileSink(resolve(directory, `${fileName}.gltf`));
  await gltf.write('{"asset":{"version":"2.0","generator":"Web Geometry open world (#332)"},');
  await gltf.write('"scene":0,"nodes":[');
  await writeArray(gltf, nodeCount, node);
  await gltf.write('],"scenes":[{"nodes":[');
  await writeArray(gltf, nodeCount, (i) => i);
  const used = [
    ...(piece.lights.length ? ['KHR_lights_punctual'] : []),
    ...(materials.usesEmissiveStrength() ? ['KHR_materials_emissive_strength'] : []),
  ];
  const materialList = materials.materials(),
    imageBytes = await writeImages(directory, materials.images(), piece.images);
  const tail = {
    // glTF refuses empty arrays and empty buffers: a piece of lamps alone writes none.
    ...(bin.length
      ? {
          meshes,
          materials: materialList,
          ...materials.textures(),
          accessors: binary.tables.accessors,
          bufferViews: binary.tables.bufferViews,
          buffers: [{ uri: binName, byteLength: bin.length }],
        }
      : {}),
    ...(used.length ? { extensionsUsed: used } : {}),
    ...(piece.lights.length
      ? { extensions: { KHR_lights_punctual: { lights: lamps.lights } } }
      : {}),
  };
  await gltf.write(`]}],${JSON.stringify(tail).slice(1)}\n`);
  await gltf.close();
  return {
    gltf: `${fileName}.gltf`,
    bin: binName,
    meshes: meshes.length,
    nodes: nodeCount,
    triangles,
    bytes: bin.length + gltf.length + imageBytes,
  };
}
