// La coupe d'une série, lue hors moteur : les identifiants de `coupe.txt` recoupés au sidecar
// `clusters.bin`, pour dire d'où viennent les triangles — par primitive, par niveau du DAG.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INT_COUNT, INT_LEVEL } from '../../packages/sdk-core/manifestBinaryFormat.ts';
import { readManifestColumns } from '../../packages/sdk-core/manifestBinaryRead.ts';
import { sceneDerived } from './scene.mjs';

const shaDe = (id) =>
  String(id)
    .match(/[0-9a-f]{64}/i)?.[0]
    .toLowerCase() ?? null;

const ranger = (map) =>
  [...map.entries()]
    .map(([nom, triangles]) => ({ nom, triangles }))
    .sort((a, b) => b.triangles - a.triangles);

/** Index SHA → { mesh, material, level, triangles }, une entrée par page du sidecar. */
function indexPages(slim, buffer) {
  const cols = readManifestColumns(slim, buffer);
  const pages = cols.pages.pageShaText,
    ints = cols.pages.ints;
  const index = new Map();
  let page = 0;
  for (const primitive of slim.primitives) {
    const n = primitive.binary?.pages ?? 0;
    for (let i = 0; i < n; i++, page++) {
      const sha = pages.substring(page * 64, page * 64 + 64).toLowerCase();
      index.set(sha, {
        mesh: primitive.mesh,
        material: primitive.material,
        level: ints[page * 8 + INT_LEVEL],
        triangles: ints[page * 8 + INT_COUNT] / 3,
      });
    }
  }
  return index;
}

/** Les noms de maillages d'un glTF, indexés comme `primitives[].mesh`. */
function nomsMaillages(gltfPath) {
  if (!existsSync(gltfPath)) return [];
  const meshes = JSON.parse(readFileSync(gltfPath, 'utf8')).meshes ?? [];
  return meshes.map((m, i) => m.name || `mesh ${i}`);
}

/** Agrège les identifiants de coupe : total, inconnues, listes triées par triangles. */
export function analyserCoupe(ids, index, meshNames = []) {
  const parPrimitive = new Map(),
    parNiveau = new Map();
  let total = 0,
    inconnues = 0;
  for (const id of ids) {
    const info = index.get(shaDe(id));
    if (!info) {
      inconnues++;
      continue;
    }
    total += info.triangles;
    const nom = meshNames[info.mesh] ?? `mesh ${info.mesh}`;
    parPrimitive.set(nom, (parPrimitive.get(nom) ?? 0) + info.triangles);
    const niveau = info.level < 0 ? 'no level' : String(info.level);
    parNiveau.set(niveau, (parNiveau.get(niveau) ?? 0) + info.triangles);
  }
  return { total, inconnues, parPrimitive: ranger(parPrimitive), parNiveau: ranger(parNiveau) };
}

const cacheIndex = new Map();

/** Charge l'index d'un dossier derived (manifeste + sidecar + noms du source.gltf). */
function chargerIndex(derived) {
  const hit = cacheIndex.get(derived);
  if (hit) return hit;
  const full = join(derived, 'native/full');
  const pointer = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8'));
  const dir = join(full, pointer.key);
  const slim = JSON.parse(readFileSync(join(dir, 'clusters.json'), 'utf8'));
  const bin = readFileSync(join(dir, 'clusters.bin'));
  const loaded = {
    index: indexPages(slim, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)),
    names: nomsMaillages(join(dir, 'source.gltf')),
  };
  cacheIndex.set(derived, loaded);
  return loaded;
}

/** Analyse un fichier de coupe contre le cache qui l'a produite ; `null` si l'un manque. */
export function analyserFichier(coupePath, derived) {
  if (!coupePath || !derived || !existsSync(coupePath) || !existsSync(derived)) return null;
  const ids = readFileSync(coupePath, 'utf8').split('\n').filter(Boolean);
  if (!ids.length) return null;
  const { index, names } = chargerIndex(derived);
  return analyserCoupe(ids, index, names);
}

/** Le dossier derived d'un côté du relevé, ou `null`. */
export function derivedDuReleve(mesurePath, cote = 'apres') {
  if (!mesurePath || !existsSync(mesurePath)) return null;
  const m = JSON.parse(readFileSync(mesurePath, 'utf8'));
  return (
    m.sides?.[cote]?.cache ?? m.sides?.apres?.cache ?? (m.scene ? sceneDerived(m.scene) : null)
  );
}

/** Le .coupe.txt voisin d'un PNG de relevé, relatif au dossier de la scène. */
export function coupeVoisine(dossier, png) {
  if (!png) return null;
  const path = join(dossier, String(png).replace(/\.png$/, '.coupe.txt'));
  return existsSync(path) ? path : null;
}
