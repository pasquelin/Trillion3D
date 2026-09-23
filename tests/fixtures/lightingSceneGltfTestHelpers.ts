export function readLightingGltf(gltf: Record<string, unknown>, binary: Uint8Array) {
  type Accessor = {
    bufferView: number;
    componentType: number;
    count: number;
    type: string;
    min: number[];
    max: number[];
  };
  const accessors = gltf.accessors as Accessor[];
  const views = gltf.bufferViews as { byteOffset: number; byteLength: number }[];
  const meshes = gltf.meshes as {
    name: string;
    primitives: {
      attributes: { POSITION: number; NORMAL: number; TEXCOORD_0: number };
      indices: number;
      material: number;
    }[];
  }[];
  const nodes = gltf.nodes as {
    name: string;
    mesh: number;
    extras: { surfaceId?: string; surfaceIndex?: number };
  }[];
  const materials = gltf.materials as {
    emissiveFactor?: number[];
    extensions?: { KHR_materials_emissive_strength: { emissiveStrength: number } };
    pbrMetallicRoughness: { roughnessFactor: number; metallicFactor: number };
  }[];
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const read = (index: number): number[] => {
    const a = accessors[index],
      view = views[a.bufferView],
      components = a.type === 'VEC3' ? 3 : a.type === 'VEC2' ? 2 : 1;
    return Array.from({ length: a.count * components }, (_, i) =>
      a.componentType === 5123
        ? data.getUint16(view.byteOffset + i * 2, true)
        : data.getFloat32(view.byteOffset + i * 4, true),
    );
  };

  return { views, meshes, nodes, materials, read };
}
