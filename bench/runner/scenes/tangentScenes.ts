#!/usr/bin/env node
// =====================================================================================
// Four normal-mapped scenes derived from the public `normal-tangent-mirror-test`: its authored
// tangents, mirrored on half the texture, drawn paged and unpaged, blended and opaque (#875).
//
//   node bench/runner/scenes/tangentScenes.ts   (prints the `assets.ts --only` line that compiles them)
//
// Every folder holds the same mesh and images. A blended pair wears the material at
// `TANGENT_BLEND_ALPHA`, an opaque pair the source material as it is. Within a pair only the pass
// the compiler picks differs: the unpaged scene carries a morph target that moves nothing, so the
// compiler keeps it outside the DAG (`shared-blend`) and the WebGPU engine draws it forward from
// its source buffers, authored tangents included; the paged one is cut into geometry pages
// (`clustered-blend`, `exact-clusters`), which store no tangent. The WebGPU engine applies no
// morph target, so the images of a pair can be compared pixel for pixel
// (`tests/gpu/webgpu/page-tangents.gpu.ts`).
// =====================================================================================
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ASSETS } from '../scene.ts';
import { sceneGltfFile } from '../assetsCatalogue.ts';

/** The public scene all four are derived from. */
const TANGENT_SOURCE = 'normal-tangent-mirror-test';
/** The derived scenes, one per surface and path, with the pass each compiles to. */
export const TANGENT_SCENES = (
  [
    { surface: 'blend', path: 'paged', pass: 'clustered-blend' },
    { surface: 'blend', path: 'unpaged', pass: 'shared-blend' },
    { surface: 'opaque', path: 'paged', pass: 'exact-clusters' },
    { surface: 'opaque', path: 'unpaged', pass: 'shared-blend' },
  ] as const
).map((entry) => ({
  ...entry,
  key: `${entry.surface}-${entry.path}`,
  scene: `normal-tangent-${entry.surface}-${entry.path}`,
}));
/** The opacity of the blended material: enough to see the normal map, and the background. */
export const TANGENT_BLEND_ALPHA = 0.7;
/** The buffer an unpaged scene's morph target reads: zeros, one position per vertex. */
const ZEROS_FILE = 'morph-zeros.bin';

type Gltf = {
  materials: Record<string, unknown>[];
  meshes: {
    primitives: { attributes: Record<string, number>; targets?: unknown[] }[];
    weights?: number[];
  }[];
  accessors: ({ count: number } & Record<string, unknown>)[];
  buffers: { uri?: string; byteLength: number }[];
  bufferViews: Record<string, unknown>[];
};

/**
 * The derived glTF: with `blended`, every material blended at `TANGENT_BLEND_ALPHA`; every other
 * property kept. `unpaged` adds, to every primitive, one morph target that moves no vertex, read from a buffer of
 * zeros whose byte length it returns (0 when the scene is paged).
 */
export function tangentSceneGltf(source: Gltf, blended: boolean, unpaged: boolean) {
  const gltf = structuredClone(source);
  if (blended)
    for (const material of gltf.materials) {
      const pbr = (material.pbrMetallicRoughness ??= {}) as { baseColorFactor?: number[] };
      const [r, g, b] = pbr.baseColorFactor ?? [1, 1, 1];
      pbr.baseColorFactor = [r, g, b, TANGENT_BLEND_ALPHA];
      material.alphaMode = 'BLEND';
    }
  if (!unpaged) return { gltf, zeroBytes: 0 };
  // Every target reads the start of one buffer of zeros, as long as the largest primitive.
  const view = gltf.bufferViews.length;
  const zero = [0, 0, 0];
  let largest = 0;
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const count = gltf.accessors[primitive.attributes.POSITION].count;
      largest = Math.max(largest, count);
      const accessor =
        gltf.accessors.push({
          bufferView: view,
          componentType: 5126,
          count,
          type: 'VEC3',
          min: zero,
          max: zero,
        }) - 1;
      primitive.targets = [{ POSITION: accessor }];
    }
    mesh.weights = [0];
  }
  const zeroBytes = largest * 12;
  const buffer = gltf.buffers.push({ uri: ZEROS_FILE, byteLength: zeroBytes }) - 1;
  gltf.bufferViews.push({ buffer, byteOffset: 0, byteLength: zeroBytes });
  return { gltf, zeroBytes };
}

/** Writes the four scenes under `ASSETS`, from the source scene already there, and prints the
 *  command that compiles them. */
function writeTangentScenes() {
  const from = join(ASSETS, TANGENT_SOURCE);
  const file = sceneGltfFile(from);
  if (!file) throw new Error(`no glTF under ${from}: run node bench/runner/assets.ts first`);
  const source = JSON.parse(readFileSync(join(from, file), 'utf8')) as Gltf;
  for (const { surface, path, scene } of TANGENT_SCENES) {
    const to = join(ASSETS, scene);
    cpSync(from, to, { recursive: true, filter: (name) => !name.endsWith('.gltf') });
    const { gltf, zeroBytes } = tangentSceneGltf(source, surface === 'blend', path === 'unpaged');
    if (zeroBytes) writeFileSync(join(to, ZEROS_FILE), Buffer.alloc(zeroBytes));
    writeFileSync(join(to, `${scene}.gltf`), `${JSON.stringify(gltf, null, 1)}\n`);
  }
  const names = TANGENT_SCENES.map(({ scene }) => scene);
  process.stdout.write(`node bench/runner/assets.ts --only ${names.join(',')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  writeTangentScenes();
