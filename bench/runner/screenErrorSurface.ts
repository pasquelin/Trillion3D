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
  const children = new Set(nodes.flatMap((node) => node.children ?? []));
  for (const [index, node] of nodes.entries()) {
    if (node.mesh === undefined) continue;
    if (children.has(index))
      throw new Error('screen error: a mesh under a parent node is not supported');
    const uniform = !node.scale || new Set(node.scale).size === 1;
    if (node.matrix || node.rotation || node.translation || node.children || !uniform)
      throw new Error('screen error: only a uniformly scaled root node per mesh is supported');
    if (scales.has(node.mesh)) throw new Error('screen error: a mesh placed twice');
    scales.set(node.mesh, node.scale ? node.scale[0] : 1);
  }
  return scales;
}

/** The cache's source glTF, the reference: every paged primitive placed in the world and, per
 *  triangle, whether its material is double-sided (a single-sided one seen from behind shows
 *  nothing); and `drawn`, which turns the clusters a WebGPU cut named (`selectedClusterIds`,
 *  `mesh/primitive/page`) into their geometry pages, decoded once each and placed. */
export async function cacheSurfaces(full: string) {
  const { dir, manifest } = await readCacheManifest(full);
  const { gltf, read, readIndices } = accessorReader(dir);
  const scales = meshScales(gltf.nodes);
  const out: number[] = [],
    twoSided: number[] = [],
    seen = new Set<string>();
  const pageOf = new Map<string, { url: string; scale: number }>();
  for (const { mesh, primitive, pages } of manifest.primitives) {
    const scale = scales.get(mesh) ?? 1;
    for (const page of pages)
      if (page.geometry)
        pageOf.set(`${mesh}/${primitive}/${page.id}`, { url: page.geometry.url, scale });
    const key = `${mesh}/${primitive}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = gltf.meshes[mesh].primitives[primitive];
    if ((source.mode ?? 4) !== 4) continue;
    const position = read(source.attributes.POSITION),
      indices =
        source.indices === undefined
          ? Uint32Array.from({ length: position.length / 3 }, (_, i) => i)
          : readIndices(source.indices);
    const doubleSided = gltf.materials?.[source.material]?.doubleSided === true ? 1 : 0;
    for (const v of indices) for (let k = 0; k < 3; k++) out.push(position[3 * v + k] * scale);
    for (let t = 0; t < indices.length; t += 3) twoSided.push(doubleSided);
  }
  const decoded = new Map<string, Float32Array>();
  const cluster = (id: string) => {
    let triangles = decoded.get(id);
    if (triangles) return triangles;
    const hit = pageOf.get(id);
    if (!hit) throw new Error(`screen error: drawn cluster ${id} has no geometry page`);
    const page = decodeGeometryPage(new Uint8Array(readFileSync(join(dir, hit.url))));
    const position = page.attributes.position;
    triangles = new Float32Array(3 * page.indices.length);
    page.indices.forEach((v, i) => {
      for (let k = 0; k < 3; k++) triangles![3 * i + k] = position[3 * v + k] * hit.scale;
    });
    decoded.set(id, triangles);
    return triangles;
  };
  const drawn = (ids: string[]) => {
    const parts = ids.map(cluster);
    const all = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) all.set(part, (at += part.length) - part.length);
    return all;
  };
  return {
    triangles: Float32Array.from(out),
    twoSided: Uint8Array.from(twoSided),
    drawn,
  };
}
