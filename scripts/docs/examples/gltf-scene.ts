import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bufferPacker } from './gltf.ts';
import type { GltfDocument, GltfMaterial, GltfNode, Primitive } from './gltf-types.ts';
import { snapped, type Mesh } from './mesh.ts';
import { snap } from './random.ts';

type Colour = readonly [number, number, number];

/**
 * A glTF scene written from nothing, for the scenes modelled in code: materials, meshes and
 * nodes are added in order and numbered as they come, every buffer in one `.bin` beside the
 * `.gltf`. The file names no machine and no date, so the same scene writes the same bytes.
 */
export class SceneGltf {
  readonly document: GltfDocument;
  private readonly pack = bufferPacker(0);

  constructor() {
    this.document = {
      asset: { version: '2.0', generator: 'Trillion3D example writer', copyright: 'CC0 1.0' },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      buffers: [],
      bufferViews: this.pack.views,
      accessors: this.pack.accessors,
    };
  }

  /** A metal–roughness material; `texture` and `normalTexture` are image paths beside the file. */
  material(
    name: string,
    colour: Colour,
    {
      roughness = 0.6,
      metallic = 0,
      texture,
      normalTexture,
    }: { roughness?: number; metallic?: number; texture?: string; normalTexture?: string } = {},
  ) {
    const material: GltfMaterial = {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [...colour, 1],
        metallicFactor: metallic,
        roughnessFactor: roughness,
        ...(texture ? { baseColorTexture: { index: this.texture(texture) } } : {}),
      },
      ...(normalTexture ? { normalTexture: { index: this.texture(normalTexture), scale: 1 } } : {}),
    };
    return this.document.materials.push(material) - 1;
  }

  /** The texture of image `uri`, added once with the one repeating, mip-mapped sampler. */
  private texture(uri: string) {
    const images = (this.document.images ??= []),
      textures = (this.document.textures ??= []);
    this.document.samplers ??= [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    const known = images.findIndex((image) => image.uri === uri);
    if (known >= 0) return textures.findIndex(({ source }) => source === known);
    images.push({ uri });
    return textures.push({ sampler: 0, source: images.length - 1 }) - 1;
  }

  /** The accessors of `mesh`, snapped to the grid, as one primitive drawn with `material`. */
  primitive(mesh: Mesh, material: number): Primitive {
    return this.pack.primitive(snapped(mesh), material);
  }

  /** A mesh of one primitive per part: a `Mesh` with its material, or a packed primitive. */
  mesh(name: string, parts: readonly (readonly [Mesh, number] | Primitive)[]) {
    const primitives = parts.map((part) =>
      'attributes' in part ? part : this.primitive(part[0], part[1]),
    );
    return this.document.meshes.push({ name, primitives }) - 1;
  }

  /** A node; a root one is listed in the scene, a child only in its parent's `children`. */
  node(node: GltfNode, root = false) {
    const index = this.document.nodes.push(node) - 1;
    if (root) this.document.scenes[0].nodes.push(index);
    return index;
  }

  /** Writes `<name>.gltf` and `<name>.bin` into `directory`. */
  async write(directory: string, name: string) {
    await mkdir(directory, { recursive: true });
    this.document.buffers = [{ uri: `${name}.bin`, byteLength: this.pack.byteLength() }];
    await writeFile(resolve(directory, `${name}.bin`), Buffer.concat(this.pack.chunks));
    await writeFile(resolve(directory, `${name}.gltf`), JSON.stringify(this.document));
  }
}

/** A turn of `angle` radians about +Y, as the quaternion a node's `rotation` takes, rounded. */
export const yaw = (angle: number) =>
  [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)].map(
    (value) => Math.round(snap(value) * 1e6) / 1e6,
  );
