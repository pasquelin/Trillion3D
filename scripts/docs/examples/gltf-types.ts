/** The glTF shapes the example recipe writes, and the material row its scenes list. */

/** One material row, `[name, baseColor, metallic, roughness]`, as the example scenes list them;
 * a fifth field carries any other glTF material field the row needs. */
export type MaterialRow = readonly [
  name: string,
  baseColorFactor: readonly [number, number, number, number],
  metallicFactor: number,
  roughnessFactor: number,
  extra?: Partial<GltfMaterial>,
];

export interface BufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target: number;
}

export interface Accessor {
  bufferView: number;
  componentType: number;
  type: string;
  count: number;
  min?: readonly number[];
  max?: readonly number[];
}

export interface Primitive {
  material: number;
  attributes: { POSITION: number; NORMAL: number; TEXCOORD_0?: number };
  indices: number;
}

export interface GltfMaterial {
  name: string;
  doubleSided?: boolean;
  pbrMetallicRoughness: {
    baseColorFactor?: readonly [number, number, number, number];
    metallicFactor?: number;
    roughnessFactor?: number;
    baseColorTexture?: { index: number };
  };
  normalTexture?: { index: number; scale: number };
  emissiveFactor?: readonly [number, number, number];
  alphaMode?: string;
  alphaCutoff?: number;
  extensions?: Record<string, unknown>;
}

/** The shape read from and written to `geometry.gltf`, the fields this recipe touches. */
export interface GltfDocument {
  asset: { version: string; generator: string; copyright?: string };
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { name: string; primitives: Primitive[] }[];
  materials: GltfMaterial[];
  buffers: { uri: string; byteLength: number }[];
  bufferViews: BufferView[];
  accessors: Accessor[];
  images?: { uri: string }[];
  textures?: { sampler: number; source: number }[];
  samplers?: { magFilter: number; minFilter: number; wrapS: number; wrapT: number }[];
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  translation?: readonly number[];
  rotation?: readonly number[];
  scale?: readonly number[];
  children?: number[];
  /** What the compiler reads beside the node: a soft body's `physics` options. */
  extras?: { physics?: object };
}
