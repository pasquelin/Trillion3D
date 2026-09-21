import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Bounds of flat xyz `values`, for the accessor a POSITION attribute requires. */
function bounds(values) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  values.forEach((value, index) => {
    min[index % 3] = Math.min(min[index % 3], value);
    max[index % 3] = Math.max(max[index % 3], value);
  });
  return { min, max };
}

/**
 * Writes the surfaces of a workshop — one `{ positions, normals, indices }` per material index,
 * `materials` as `[name, baseColor, metallic, roughness]` rows — as `geometry.gltf` +
 * `geometry.bin` in `directory`: one mesh, one primitive per material, nothing external.
 */
export async function writeSurfacesGltf(directory, name, materials, surfaces) {
  const views = [],
    accessors = [],
    chunks = [];
  let byteLength = 0;
  const accessor = (values, indices) => {
    const data = indices ? Uint32Array.from(values) : Float32Array.from(values);
    views.push({
      buffer: 0,
      byteOffset: byteLength,
      byteLength: data.byteLength,
      target: indices ? 34963 : 34962,
    });
    chunks.push(Buffer.from(data.buffer));
    byteLength += data.byteLength;
    accessors.push({
      bufferView: views.length - 1,
      componentType: indices ? 5125 : 5126,
      type: indices ? 'SCALAR' : 'VEC3',
      count: indices ? values.length : values.length / 3,
      ...(indices ? {} : bounds(values)),
    });
    return accessors.length - 1;
  };
  const primitives = [...surfaces].map(([material, mesh]) => ({
    material,
    attributes: { POSITION: accessor(mesh.positions), NORMAL: accessor(mesh.normals) },
    indices: accessor(mesh.indices, true),
  }));
  const gltf = {
    asset: {
      version: '2.0',
      generator: 'Web Geometry examples recipe v1',
      copyright: 'Original Web Geometry contributors; repository license',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials: materials.map(([label, baseColorFactor, metallicFactor, roughnessFactor]) => ({
      name: label,
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor, metallicFactor, roughnessFactor },
    })),
    buffers: [{ uri: 'geometry.bin', byteLength }],
    bufferViews: views,
    accessors,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  await writeFile(resolve(directory, 'geometry.bin'), Buffer.concat(chunks));
}
