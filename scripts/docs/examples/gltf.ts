import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Mesh } from './mesh.ts';
import type {
  Accessor,
  BufferView,
  GltfDocument,
  GltfMaterial,
  MaterialRow,
  Primitive,
} from './gltf-types.ts';

/** Bounds of flat `values` of `size` components, for the accessor a POSITION attribute requires. */
function bounds(values: readonly number[], size: number) {
  const min: number[] = Array(size).fill(Infinity),
    max: number[] = Array(size).fill(-Infinity);
  values.forEach((value, index) => {
    min[index % size] = Math.min(min[index % size], value);
    max[index % size] = Math.max(max[index % size], value);
  });
  return { min, max };
}

/**
 * Packs flat attribute and index arrays into one binary chunk list: the views and accessors of
 * buffer `buffer`, numbered from `firstView` and `firstAccessor`. Every value is four bytes, so
 * each view starts aligned.
 */
export function bufferPacker(buffer: number, firstView = 0, firstAccessor = 0) {
  const views: BufferView[] = [],
    accessors: Accessor[] = [],
    chunks: Buffer[] = [];
  let byteLength = 0;
  const accessor = (values: readonly number[], size: number): number => {
    const indices = size === 1,
      data = indices ? Uint32Array.from(values) : Float32Array.from(values);
    views.push({
      buffer,
      byteOffset: byteLength,
      byteLength: data.byteLength,
      target: indices ? 34963 : 34962,
    });
    chunks.push(Buffer.from(data.buffer));
    byteLength += data.byteLength;
    accessors.push({
      bufferView: firstView + views.length - 1,
      componentType: indices ? 5125 : 5126,
      type: indices ? 'SCALAR' : `VEC${size}`,
      count: values.length / size,
      ...(indices ? {} : bounds(values, size)),
    });
    return firstAccessor + accessors.length - 1;
  };
  /** One primitive of `mesh` drawn with `material`; `uv` adds its texture coordinates. */
  const primitive = (mesh: Mesh, material: number, uv = mesh.uvs.length > 0): Primitive => ({
    material,
    attributes: {
      POSITION: accessor(mesh.positions, 3),
      NORMAL: accessor(mesh.normals, 3),
      ...(uv ? { TEXCOORD_0: accessor(mesh.uvs, 2) } : {}),
    },
    indices: accessor(mesh.indices, 1),
  });
  return { views, accessors, chunks, primitive, byteLength: () => byteLength };
}

/** A material row: name, base colour, metalness, roughness, then any glTF field of its own. */
const material = ([
  name,
  baseColorFactor,
  metallicFactor,
  roughnessFactor,
  extra,
]: MaterialRow): GltfMaterial => ({
  name,
  doubleSided: true,
  pbrMetallicRoughness: { baseColorFactor, metallicFactor, roughnessFactor },
  ...extra,
});

/**
 * Appends workshop surfaces to an imported glTF as one more node, in their own `setting.bin`:
 * the model's own buffers, textures and nodes stay untouched. Writes the result as
 * `geometry.gltf` in `directory`.
 */
export async function appendSurfacesGltf(
  gltf: GltfDocument,
  directory: string,
  name: string,
  materials: readonly MaterialRow[],
  surfaces: Iterable<[number, Mesh]>,
) {
  const { views, accessors, chunks, primitive, byteLength } = bufferPacker(
      gltf.buffers.length,
      gltf.bufferViews.length,
      gltf.accessors.length,
    ),
    primitives = [...surfaces].map(([index, mesh]) =>
      primitive(mesh, gltf.materials.length + index, false),
    );
  gltf.buffers.push({ uri: 'setting.bin', byteLength: byteLength() });
  gltf.bufferViews.push(...views);
  gltf.accessors.push(...accessors);
  gltf.materials.push(...materials.map(material));
  gltf.meshes.push({ name, primitives });
  gltf.nodes.push({ name, mesh: gltf.meshes.length - 1 });
  gltf.scenes[gltf.scene ?? 0].nodes.push(gltf.nodes.length - 1);
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  await writeFile(resolve(directory, 'setting.bin'), Buffer.concat(chunks));
}
