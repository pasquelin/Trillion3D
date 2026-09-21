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

/** The buffer views, accessors and primitives of workshop surfaces, in one binary chunk list. */
function surfacesBuffers(surfaces, buffer, firstView, firstAccessor, firstMaterial) {
  const views = [],
    accessors = [],
    chunks = [];
  let byteLength = 0;
  const accessor = (values, indices) => {
    const data = indices ? Uint32Array.from(values) : Float32Array.from(values);
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
      type: indices ? 'SCALAR' : 'VEC3',
      count: indices ? values.length : values.length / 3,
      ...(indices ? {} : bounds(values)),
    });
    return firstAccessor + accessors.length - 1;
  };
  const primitives = [...surfaces].map(([material, mesh]) => ({
    material: firstMaterial + material,
    attributes: { POSITION: accessor(mesh.positions), NORMAL: accessor(mesh.normals) },
    indices: accessor(mesh.indices, true),
  }));
  return { views, accessors, primitives, chunks, byteLength };
}

const material = ([name, baseColorFactor, metallicFactor, roughnessFactor]) => ({
  name,
  doubleSided: true,
  pbrMetallicRoughness: { baseColorFactor, metallicFactor, roughnessFactor },
});

/**
 * Writes the surfaces of a workshop — one `{ positions, normals, indices }` per material index,
 * `materials` as `[name, baseColor, metallic, roughness]` rows — as `geometry.gltf` +
 * `geometry.bin` in `directory`: one mesh, one primitive per material, nothing external.
 */
export async function writeSurfacesGltf(directory, name, materials, surfaces) {
  const { views, accessors, primitives, chunks, byteLength } = surfacesBuffers(
    surfaces,
    0,
    0,
    0,
    0,
  );
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
    materials: materials.map(material),
    buffers: [{ uri: 'geometry.bin', byteLength }],
    bufferViews: views,
    accessors,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  await writeFile(resolve(directory, 'geometry.bin'), Buffer.concat(chunks));
}

/**
 * Appends workshop surfaces to an imported glTF as one more node, in their own `setting.bin`:
 * the model's own buffers, textures and nodes stay untouched. Writes the result as
 * `geometry.gltf` in `directory`.
 */
export async function appendSurfacesGltf(gltf, directory, name, materials, surfaces) {
  const { views, accessors, primitives, chunks, byteLength } = surfacesBuffers(
    surfaces,
    gltf.buffers.length,
    gltf.bufferViews.length,
    gltf.accessors.length,
    gltf.materials.length,
  );
  gltf.buffers.push({ uri: 'setting.bin', byteLength });
  gltf.bufferViews.push(...views);
  gltf.accessors.push(...accessors);
  gltf.materials.push(...materials.map(material));
  gltf.meshes.push({ name, primitives });
  gltf.nodes.push({ name, mesh: gltf.meshes.length - 1 });
  gltf.scenes[gltf.scene ?? 0].nodes.push(gltf.nodes.length - 1);
  await writeFile(resolve(directory, 'geometry.gltf'), JSON.stringify(gltf));
  await writeFile(resolve(directory, 'setting.bin'), Buffer.concat(chunks));
}
