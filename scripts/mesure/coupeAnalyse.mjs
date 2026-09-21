// Cut of a series, read off the engine: identifiers from `coupe.txt` crossed with the
// `clusters.bin` sidecar, to say where the triangles come from — by primitive, by DAG level.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCacheManifest } from './cacheManifest.mjs';

const shaOf = (id) =>
  String(id)
    .match(/[0-9a-f]{64}/i)?.[0]
    .toLowerCase() ?? null;

const ranked = (map) =>
  [...map.entries()]
    .map(([name, triangles]) => ({ name, triangles }))
    .sort((a, b) => b.triangles - a.triangles);

/** SHA index → { mesh, material, level, triangles }, one entry per page of the manifest. */
function indexPages(manifest) {
  const index = new Map();
  for (const primitive of manifest.primitives)
    for (const page of primitive.pages)
      index.set(page.sha256.toLowerCase(), {
        mesh: primitive.mesh,
        material: primitive.material,
        level: page.level ?? -1,
        triangles: page.count / 3,
      });
  return index;
}

/** Mesh names of a glTF, indexed like `primitives[].mesh`. */
function meshNames(gltfPath) {
  if (!existsSync(gltfPath)) return [];
  const meshes = JSON.parse(readFileSync(gltfPath, 'utf8')).meshes ?? [];
  return meshes.map((m, i) => m.name || `mesh ${i}`);
}

/** Aggregates cut identifiers: total, unknowns, lists sorted by triangles. */
export function analyseCut(ids, index, meshNames = []) {
  const byPrimitive = new Map(),
    byLevel = new Map();
  let total = 0,
    unknown = 0;
  for (const id of ids) {
    const info = index.get(shaOf(id));
    if (!info) {
      unknown++;
      continue;
    }
    total += info.triangles;
    const name = meshNames[info.mesh] ?? `mesh ${info.mesh}`;
    byPrimitive.set(name, (byPrimitive.get(name) ?? 0) + info.triangles);
    const level = info.level < 0 ? 'no level' : String(info.level);
    byLevel.set(level, (byLevel.get(level) ?? 0) + info.triangles);
  }
  return { total, unknown, byPrimitive: ranked(byPrimitive), byLevel: ranked(byLevel) };
}

const cacheIndex = new Map();

/** Loads the index of a derived directory (manifest + sidecar + source.gltf names). */
function loadIndex(derived) {
  const hit = cacheIndex.get(derived);
  if (hit) return hit;
  const { dir, manifest } = readCacheManifest(join(derived, 'native/full'));
  const loaded = { index: indexPages(manifest), names: meshNames(join(dir, 'source.gltf')) };
  cacheIndex.set(derived, loaded);
  return loaded;
}

/** Analyses a cut file against the cache that produced it; `null` if either is missing. */
export function analyseFile(coupePath, derived) {
  if (!coupePath || !derived || !existsSync(coupePath) || !existsSync(derived)) return null;
  const ids = readFileSync(coupePath, 'utf8').split('\n').filter(Boolean);
  if (!ids.length) return null;
  const { index, names } = loadIndex(derived);
  return analyseCut(ids, index, names);
}

/** The .coupe.txt next to a reading PNG, relative to the scene folder. */
export function neighboringCut(folder, png) {
  if (!png) return null;
  const path = join(folder, String(png).replace(/\.png$/, '.coupe.txt'));
  return existsSync(path) ? path : null;
}
