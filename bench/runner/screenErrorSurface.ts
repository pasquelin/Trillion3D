// The two surfaces the screen-error measure compares, as world-space triangles (nine numbers
// each): the source glTF at full precision, the reference, and the pages a WebGPU cut drew,
// decoded by the engine's page decoder. The WGSL decode is that decoder bit for bit
// (`tests/browser/probes/cluster-decoding-gpu.ts`); WebGL2 hands its drawn triangles back itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCacheManifest } from './cacheManifest.ts';
import { accessorReader } from './pageQuantization.ts';
import { decodeGeometryPage } from '../../packages/sdk-browser/src/page/decode/geometryPage.ts';

interface GltfNode {
  mesh?: number;
  scale?: number[];
  matrix?: number[];
  rotation?: number[];
  translation?: number[];
  children?: number[];
}

/**
 * The uniform scale each mesh is placed at. The scenes measured here (the audit's meshes, Sponza)
 * hang each mesh on one root node whose only transform is a uniform scale; any other layout is
 * refused rather than measured wrong.
 */
function meshScales(nodes: GltfNode[]) {
  const scales = new Map<number, number>();
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const uniform = !node.scale || new Set(node.scale).size === 1;
    if (node.matrix || node.rotation || node.translation || node.children || !uniform)
      throw new Error('screen error: only a uniformly scaled root node per mesh is supported');
    if (scales.has(node.mesh)) throw new Error('screen error: a mesh placed twice');
    scales.set(node.mesh, node.scale ? node.scale[0] : 1);
  }
  return scales;
}

/** Every paged primitive of the cache's source glTF, placed in the world, and per triangle
 *  whether its material is double-sided (a single-sided one seen from behind shows nothing). */
export async function sourceTriangles(full: string) {
  const { dir, manifest } = await readCacheManifest(full);
  const { gltf, read, readIndices } = accessorReader(dir);
  const scales = meshScales(gltf.nodes);
  const out: number[] = [],
    twoSided: number[] = [],
    seen = new Set<string>();
  for (const { mesh, primitive } of manifest.primitives) {
    const key = `${mesh}/${primitive}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = gltf.meshes[mesh].primitives[primitive];
    if ((source.mode ?? 4) !== 4) continue;
    const scale = scales.get(mesh) ?? 1;
    const position = read(source.attributes.POSITION),
      indices = readIndices(source.indices);
    const doubleSided = gltf.materials?.[source.material]?.doubleSided === true ? 1 : 0;
    for (const v of indices) for (let k = 0; k < 3; k++) out.push(position[3 * v + k] * scale);
    for (let t = 0; t < indices.length; t += 3) twoSided.push(doubleSided);
  }
  return { triangles: Float32Array.from(out), twoSided: Uint8Array.from(twoSided) };
}

/** The pages named by `ids` (the WebGPU backend's `selectedPageIds`), decoded and placed. */
export async function pageTriangles(full: string, ids: string[]) {
  const { dir, manifest } = await readCacheManifest(full);
  const scales = meshScales(accessorReader(dir).gltf.nodes);
  const bySha = new Map<string, { url: string; scale: number }>();
  for (const primitive of manifest.primitives)
    for (const page of primitive.pages)
      if (page.geometry)
        bySha.set(page.sha256.toLowerCase(), {
          url: page.geometry.url,
          scale: scales.get(primitive.mesh) ?? 1,
        });
  const out: number[] = [];
  let missing = 0;
  for (const id of ids) {
    const hit = bySha.get(id.match(/[0-9a-f]{64}/i)?.[0].toLowerCase() ?? '');
    if (!hit) {
      missing++;
      continue;
    }
    const page = decodeGeometryPage(new Uint8Array(readFileSync(join(dir, hit.url))));
    const position = page.attributes.position;
    for (const v of page.indices)
      for (let k = 0; k < 3; k++) out.push(position[3 * v + k] * hit.scale);
  }
  if (missing) throw new Error(`screen error: ${missing} drawn pages absent from the cache`);
  return Float32Array.from(out);
}
