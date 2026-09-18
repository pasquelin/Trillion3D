// La scène mesurée et le cache qui la porte. Le harnais ne connaît aucune scène : il déduit son nom
// du cache qu'on lui donne, et ne réclame le dossier d'assets que lorsqu'un côté le lit vraiment.
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// Les assets du banc, en lecture seule : `<scène>/` (sources glTF) et `<scène>-derived/` (cache
// compilé par notre compilateur, voir `README.md` § Assets) sous `.mesure/assets/` du dépôt, hors
// git. `WG_ASSETS` pointe un autre dossier — une copie figée, ou celui d'un autre arbre de travail.
export const ASSETS = process.env.WG_ASSETS
  ? resolve(process.env.WG_ASSETS)
  : resolve(import.meta.dirname, '../../.mesure/assets');

/** La scène que le harnais mesure quand aucun cache compilé ne lui en nomme une : la scène de
 *  référence du banc. C'est un repli, pas une cible — le banc mesure la scène qu'on lui donne. */
export const DEFAULT_SCENE = 'emerald-square';

/** Le nom de la scène d'un côté, déduit du cache qu'il joue : le dossier « derived » d'un cache
 *  compilé porte le nom du modèle (`<nom>-derived`). Sans cache nommé, le côté lit celui des
 *  assets, sous le nom par défaut. C'est la seule ligne du harnais qui nomme une scène. */
export function sceneOf(cache) {
  if (!cache) return DEFAULT_SCENE;
  const name = basename(resolve(cache));
  return name.endsWith('-derived') ? name.slice(0, -'-derived'.length) : name;
}

/** L'URL du manifeste du cache d'une scène des assets. Sa présence n'est exigée que si un côté le
 *  lit : une comparaison dont les deux côtés nomment leur propre cache n'en a pas besoin. */
export function assetsManifest(scene, needed) {
  if (needed && !existsSync(join(ASSETS, `${scene}-derived/native/full/manifest.json`)))
    throw new Error(`cache absent : ${join(ASSETS, `${scene}-derived`)}`);
  return `/benchmark-assets/${scene}-derived/native/full/manifest.json`;
}
