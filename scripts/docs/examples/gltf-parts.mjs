import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { examplesDocument, material, surfacesBuffers } from './gltf.mjs';

/**
 * Writes a scene of named parts as `geometry.gltf` in `directory`. Each part — `{ name,
 * surfaces }` from a workshop — becomes one mesh in its own `<part>.bin`; `nodes` place it as
 * many times as the scene needs, `{ name, part?, translation?, rotation?, scale?, children?,
 * light? }` each: a node the engine moves by name, an instance the compiler places once and
 * draws everywhere, a lamp the file carries (`KHR_lights_punctual`). `images` names the PNG
 * files beside the glTF, one texture each, that a material row's extra field may index; `uv`
 * writes the workshop's texture coordinates with every part.
 */
export async function writePartsGltf(directory, name, materials, parts, nodes, options = {}) {
  const { images = [], uv = images.length > 0 } = options;
  const gltf = {
    ...examplesDocument(),
    scenes: [{ name, nodes: [] }],
    nodes: [],
    meshes: [],
    materials: materials.map(material),
    buffers: [],
    bufferViews: [],
    accessors: [],
  };
  const files = [];
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
  const lights = [];
  const place = (node) => {
    const index = gltf.nodes.length,
      entry = { name: node.name };
    if (node.part !== undefined) {
      entry.mesh = parts.findIndex((part) => part.name === node.part);
      if (entry.mesh < 0) throw new Error(`Unknown part: ${node.part}`);
    }
    // Four decimals: a tenth of a millimetre, and a node list of ten thousand stays readable.
    for (const field of ['translation', 'rotation', 'scale'])
      if (node[field]) entry[field] = node[field].map((value) => Number(value.toFixed(4)));
    if (node.light)
      entry.extensions = { KHR_lights_punctual: { light: lights.push(node.light) - 1 } };
    gltf.nodes.push(entry);
    if (node.children) entry.children = node.children.map(place);
    return index;
  };
  gltf.scenes[0].nodes = nodes.map(place);
  if (lights.length) {
    gltf.extensionsUsed = ['KHR_lights_punctual'];
    gltf.extensions = { KHR_lights_punctual: { lights } };
  }
  if (images.length) {
    gltf.images = images.map((uri) => ({ uri }));
    gltf.textures = images.map((_, source) => ({ source }));
  }
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  for (const [file, bytes] of files) await writeFile(resolve(directory, file), bytes);
}

/** The quaternion of a rotation of `angle` radians about the unit `axis`, as glTF writes it. */
export const rotation = (axis, angle) => [
  ...axis.map((value) => value * Math.sin(angle / 2)),
  Math.cos(angle / 2),
];
