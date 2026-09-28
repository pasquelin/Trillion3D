#!/usr/bin/env node
// =====================================================================================
// Two transparent, normal-mapped scenes derived from the public `normal-tangent-mirror-test`:
// its authored tangents, mirrored on half the texture, under a blended material (#875).
//
//   node bench/runner/scenes/tangentBlend.ts
//   node bench/runner/assets.ts --only normal-tangent-blend-paged,normal-tangent-blend-unpaged
//
// Both folders hold the same mesh, material and images. Only the pass the compiler picks
// differs: the unpaged one carries a morph target that moves nothing, so the compiler keeps it
// outside the DAG (`shared-blend`) and the engine draws it from its source buffers, authored
// tangents included, while the paged one draws from its geometry pages (`clustered-blend`). The
// WebGPU engine applies no morph target, so the two images can be compared pixel for pixel
// (`tests/browser/renders/blend-page-tangents.browser.ts`).
// =====================================================================================
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ASSETS } from '../scene.ts';
import { sceneGltfFile } from '../assetsCatalogue.ts';

/** The public scene both are derived from. */
export const TANGENT_SOURCE = 'normal-tangent-mirror-test';
/** The two derived scenes, by the path their transparent surface takes. */
export const TANGENT_BLEND_SCENES = {
  paged: 'normal-tangent-blend-paged',
  unpaged: 'normal-tangent-blend-unpaged',
} as const;
/** The opacity of the blended material: enough to see the normal map, and the background. */
export const TANGENT_BLEND_ALPHA = 0.7;
/** The buffer the unpaged scene's morph target reads: zeros, one position per vertex. */
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
 * The derived glTF: every material blended at `TANGENT_BLEND_ALPHA`, every other property kept.
 * `unpaged` adds, to every primitive, one morph target that moves no vertex, read from a buffer of
 * zeros whose byte length it returns (0 when the scene is paged).
 */
export function tangentBlendGltf(source: Gltf, unpaged: boolean) {
  const gltf = structuredClone(source);
  for (const material of gltf.materials) {
    const pbr = (material.pbrMetallicRoughness ??= {}) as { baseColorFactor?: number[] };
    const [r, g, b] = pbr.baseColorFactor ?? [1, 1, 1];
    pbr.baseColorFactor = [r, g, b, TANGENT_BLEND_ALPHA];
    material.alphaMode = 'BLEND';
  }
  if (!unpaged) return { gltf, zeroBytes: 0 };
  const counts = gltf.meshes.flatMap((mesh) =>
    mesh.primitives.map((p) => gltf.accessors[p.attributes.POSITION].count),
  );
  const zeroBytes = Math.max(...counts) * 12;
  const buffer = gltf.buffers.push({ uri: ZEROS_FILE, byteLength: zeroBytes }) - 1;
  const view = gltf.bufferViews.push({ buffer, byteOffset: 0, byteLength: zeroBytes }) - 1;
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const count = gltf.accessors[primitive.attributes.POSITION].count;
      const zero = [0, 0, 0];
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
  return { gltf, zeroBytes };
}

/** Writes both scenes under `assets`, from the source scene already there. */
export function writeTangentBlendScenes(assets = ASSETS) {
  const from = join(assets, TANGENT_SOURCE);
  const file = sceneGltfFile(from);
  if (!file) throw new Error(`no glTF under ${from}: run node bench/runner/assets.ts first`);
  const source = JSON.parse(readFileSync(join(from, file), 'utf8')) as Gltf;
  for (const [path, scene] of Object.entries(TANGENT_BLEND_SCENES)) {
    const to = join(assets, scene);
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from))
      if (!name.endsWith('.gltf')) copyFileSync(join(from, name), join(to, name));
    const { gltf, zeroBytes } = tangentBlendGltf(source, path === 'unpaged');
    if (zeroBytes) writeFileSync(join(to, ZEROS_FILE), Buffer.alloc(zeroBytes));
    writeFileSync(join(to, `${scene}.gltf`), `${JSON.stringify(gltf, null, 1)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  writeTangentBlendScenes();
