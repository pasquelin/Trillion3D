// Les scènes de référence du banc, et le cache qui les porte. Le moteur ne nomme aucune scène : le
// harnais déduit le nom du cache, et la campagne joue celles-ci quand on ne lui en donne pas.
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// Les assets du banc, en lecture seule : `<scène>/` (sources) et `<scène>-derived/` (cache
// compilé, voir `README.md` § Assets) sous `.mesure/assets/` du dépôt, hors git. `WG_ASSETS`
// pointe un autre dossier — une copie figée, ou celui d'un autre arbre de travail.
export const ASSETS = process.env.WG_ASSETS
  ? resolve(process.env.WG_ASSETS)
  : resolve(import.meta.dirname, '../../.mesure/assets');

/** Repli du harnais quand aucun cache nommé ne lui donne de scène. */
export const DEFAULT_SCENE = 'emerald-square';

/** Les deux scènes que la campagne joue, dans cet ordre, dès que leur cache est là. */
export const REFERENCE_SCENES = ['emerald-square', 'whisperwind-village'];

/** Ce que le rapport doit dire d'une scène, et qui ne se lit pas dans un relevé. */
export const SCENE_NOTES = {
  'whisperwind-village':
    'Unreal FBX, heavy instancing (one wall × 1,292). 81 materials, 6 textured: the export omitted Megascans textures — not on us; re-export from Unreal.',
};

export const sceneDerived = (scene, assets = ASSETS) => join(assets, `${scene}-derived`);

const cachePret = (scene, assets) =>
  existsSync(join(sceneDerived(scene, assets), 'native/full/manifest.json'));

/** Les scènes d'une campagne : `--scene a,b`, sinon les références dont le cache est prêt. */
export function scenesOf(flags, assets = ASSETS) {
  const raw = flags.get('scene');
  if (raw && raw !== 'true') return raw.split(',').filter(Boolean);
  return REFERENCE_SCENES.filter((scene) => cachePret(scene, assets));
}

/** `--scene nom` pose le cache des assets sur chaque côté qui n'a pas le sien. */
export function applySceneFlag(flags, assets = ASSETS) {
  const scene = flags.get('scene');
  if (!scene || scene === 'true') return;
  const derived = sceneDerived(scene, assets);
  if (!flags.has('cache-apres')) flags.set('cache-apres', derived);
  if (flags.has('avant') && !flags.has('cache-avant')) flags.set('cache-avant', derived);
}

/** Le nom de la scène d'un côté, déduit du cache : le dossier « derived » porte `<nom>-derived`. */
export function sceneOf(cache) {
  if (!cache) return DEFAULT_SCENE;
  const name = basename(resolve(cache));
  return name.endsWith('-derived') ? name.slice(0, -'-derived'.length) : name;
}

/** L'URL du manifeste du cache d'une scène des assets. Exigé seulement si un côté le lit. */
export function assetsManifest(scene, needed) {
  if (needed && !cachePret(scene, ASSETS)) throw new Error(`cache absent : ${sceneDerived(scene)}`);
  return `/benchmark-assets/${scene}-derived/native/full/manifest.json`;
}

/**
 * L'URL du glTF du témoin Three : le fichier des sources, sinon `source.gltf` écrit par le
 * compilateur à côté du cache — un FBX n'a pas de glTF dans le dossier source.
 */
export function gltfUrlIn(assets, scene) {
  const dossier = join(assets, scene);
  const gltf = existsSync(dossier) ? readdirSync(dossier).find((f) => f.endsWith('.gltf')) : null;
  if (gltf) return `/benchmark-assets/${scene}/${gltf}`;
  const full = join(sceneDerived(scene, assets), 'native/full');
  if (existsSync(full))
    for (const key of readdirSync(full))
      if (existsSync(join(full, key, 'source.gltf')))
        return `/benchmark-assets/${scene}-derived/native/full/${key}/source.gltf`;
  throw new Error(`glTF source absent : ${dossier}`);
}

export const sceneGltf = (scene) => gltfUrlIn(ASSETS, scene);
