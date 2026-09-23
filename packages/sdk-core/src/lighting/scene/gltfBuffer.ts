export function createLightingGltfBuffer() {
  const chunks: Uint8Array[] = [];
  const bufferViews: Record<string, unknown>[] = [],
    accessors: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [],
    meshes: Record<string, unknown>[] = [],
    nodes: Record<string, unknown>[] = [];
  let byteLength = 0;
  const accessor = (values: number[], components: number, index = false): number => {
    const bytesPerValue = index ? 2 : 4;
    const chunk = new Uint8Array(Math.ceil((values.length * bytesPerValue) / 4) * 4);
    const view = new DataView(chunk.buffer);
    for (let i = 0; i < values.length; i++) {
      if (index) view.setUint16(i * 2, values[i], true);
      else view.setFloat32(i * 4, values[i], true);
    }
    const bufferView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: byteLength,
      byteLength: values.length * bytesPerValue,
      target: index ? 34963 : 34962,
    });
    chunks.push(chunk);
    byteLength += chunk.byteLength;
    const min = Array.from({ length: components }, () => Infinity),
      max = min.map(() => -Infinity);
    values.forEach((_, i) => {
      const component = i % components,
        value = index ? view.getUint16(i * 2, true) : view.getFloat32(i * 4, true);
      min[component] = Math.min(min[component], value);
      max[component] = Math.max(max[component], value);
    });
    accessors.push({
      bufferView,
      byteOffset: 0,
      componentType: index ? 5123 : 5126,
      count: values.length / components,
      type: components === 1 ? 'SCALAR' : components === 2 ? 'VEC2' : 'VEC3',
      min,
      max,
    });
    return accessors.length - 1;
  };
  const mesh = (
    name: string,
    positions: number[],
    normals: number[],
    uv: number[],
    indices: number[],
    material: number,
    extras: Record<string, unknown>,
  ): void => {
    const attributes = {
      POSITION: accessor(positions, 3),
      NORMAL: accessor(normals, 3),
      TEXCOORD_0: accessor(uv, 2),
    };
    meshes.push({
      name,
      extras,
      primitives: [{ attributes, indices: accessor(indices, 1, true), material, mode: 4 }],
    });
    nodes.push({ name, mesh: meshes.length - 1, extras });
  };
  const finish = () => {
    const binary = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      binary.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const gltf: Record<string, unknown> = {
      asset: { version: '2.0', generator: 'Trillion3D lighting experiment' },
      scene: 0,
      scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes,
      meshes,
      materials,
      accessors,
      bufferViews,
      buffers: [{ uri: 'scene.bin', byteLength }],
    };
    return { gltf, binary };
  };
  return { materials, mesh, finish };
}
