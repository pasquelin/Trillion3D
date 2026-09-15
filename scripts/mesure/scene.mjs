// La scène mesurée et le cache qui la porte. Le harnais ne connaît aucune scène : il déduit son nom
// du cache qu'on lui donne, et ne réclame celui du Lab que lorsqu'un côté le lit vraiment.
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { LAB } from './poses.mjs';

// Le cache du banc, en lecture seule. `WG_ASSETS` laisse un agent pointer une copie figée hors du
// Lab : la mesure lit alors ses propres octets, et le Lab n'est ni lu ni touché pendant la série.
export const ASSETS = process.env.WG_ASSETS
  ? resolve(process.env.WG_ASSETS)
  : join(LAB, 'public/benchmark-assets');

/** La scène que le harnais mesure quand aucun cache compilé ne lui en nomme une : celle que le Lab
 *  garde par défaut. C'est un repli, pas une cible — le banc mesure la scène qu'on lui donne. */
export const DEFAULT_SCENE = 'emerald-square';

/** Le nom de la scène d'un côté, déduit du cache qu'il joue : le dossier « derived » d'un cache
 *  compilé porte le nom du modèle (`<nom>-derived`). Sans cache nommé, le côté lit celui du Lab,
 *  sous le nom par défaut. C'est la seule ligne du harnais qui nomme une scène. */
export function sceneOf(cache) {
  if (!cache) return DEFAULT_SCENE;
  const name = basename(resolve(cache));
  return name.endsWith('-derived') ? name.slice(0, -'-derived'.length) : name;
}

/** L'URL du manifeste du cache du Lab pour une scène. Sa présence n'est exigée que si un côté le
 *  lit : une comparaison dont les deux côtés nomment leur propre cache n'a pas besoin du Lab. */
export function labManifest(scene, needed) {
  if (needed && !existsSync(join(ASSETS, `${scene}-derived/native/full/manifest.json`)))
    throw new Error(`cache absent : ${join(ASSETS, `${scene}-derived`)}`);
  return `/benchmark-assets/${scene}-derived/native/full/manifest.json`;
}
