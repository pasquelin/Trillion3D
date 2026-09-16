// Ce qui distingue un côté de la comparaison de l'autre : son moteur, son cache compilé et sa
// variante de diagnostic. Séparé de `options.mjs`, qui ne lit plus que les réglages de campagne.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Drapeaux copiés littéralement de `render-tech-lab/scripts/headless/lib.mjs` (BASE_FLAGS) et de
// `shots.mjs` (`--enable-unsafe-webgpu`). Le Lab n'est pas modifié ; ces lignes en sont la copie.
const BASE_FLAGS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--enable-gpu-benchmarking',
];
const WEBGPU_FLAGS = [...BASE_FLAGS, '--enable-unsafe-webgpu'];

// Le moteur autonome WebGL2 est le seul des trois à décoder lui-même des pages de géométrie :
// c'est par lui que `pagesDecodedWasm` cesse d'être nul en campagne. L'explorateur ne le choisit pas
// par une liste de moteurs mais par le réglage `autonomousGeometry`, et il refuse qu'on lui nomme
// les deux à la fois ; `autonome` porte cette différence jusqu'à la page de mesure, qui passe alors
// le réglage au lieu de la liste. Il exige aussi un cache dont toutes les primitives sont des
// clusters exacts — le compilateur n'écrit `autonomousScene` que dans ce cas — sinon l'explorateur
// refuse par `AUTONOMOUS_SCENE_UNAVAILABLE`.
// `three` dit que le moteur dessine par Three.js, donc qu'il recopie les lampes d'un graphe source
// au lieu de lire le magasin du contrat : à celui-là seul, l'hôte pose les lampes en Three.
export const ENGINES = {
  webgl: {
    backend: 'exactPagesBackend',
    id: 'exact-cluster-pages',
    flags: BASE_FLAGS,
    three: true,
  },
  webgpu: { backend: 'webgpuPagesBackend', id: 'webgpu-page-raster', flags: WEBGPU_FLAGS },
  webgl2: {
    backend: 'autonomousPagesBackend',
    id: 'autonomous-pages-webgl',
    flags: BASE_FLAGS,
    autonome: true,
    three: true,
  },
};

/** Le cache, le moteur et la variante de diagnostic d'un côté, lus une fois de la ligne de commande. */
export function equipSide(side, flags, settings) {
  side.cache = resolveCache(flags.get(`cache-${side.name}`));
  side.engine = engineOf(flags, side.name, settings.engine);
  side.variante = variantOf(flags, side.name);
}

/** Ce qu'un côté publie de lui-même dans le relevé : son dist, son cache, son moteur, sa variante. */
export const sideReport = (side) => [
  side.name,
  {
    dist: side.dist,
    from: side.from,
    cache: side.cache ?? null,
    moteur: side.engine.id,
    variante: side.variante,
  },
];

/** La variante de diagnostic d'un côté : `--variante-<côté>`, sinon celle de la campagne. Deux
 *  côtés qui ne diffèrent que par elle sont deux variantes d'une seule campagne. */
export function variantOf(flags, name) {
  return flags.get(`variante-${name}`) ?? flags.get('variante') ?? null;
}

/** Le moteur d'un côté : `--moteur-<côté>` s'il est donné, sinon celui de la campagne. C'est ce qui
 *  met le moteur face au témoin en une seule exécution — mêmes poses, mêmes lampes, même cache. */
export function engineOf(flags, name, fallback) {
  const engine = flags.get(`moteur-${name}`) ?? fallback;
  if (!ENGINES[engine])
    throw new Error(`--moteur-${name} doit valoir ${Object.keys(ENGINES).join(', ')}`);
  return ENGINES[engine];
}

/**
 * Le cache d'un côté. La valeur nomme le dossier « derived » — celui qui contient `native/full` —
 * ou directement `native/full` ; c'est le dossier derived qui est rendu, parce que le manifeste
 * compilé désigne ses paquets par `../../objects/`, hors de `native/full`. Sans valeur, le côté
 * garde le cache du Lab.
 */
export function resolveCache(value) {
  if (!value) return undefined;
  const dir = resolve(value);
  for (const candidate of [dir, join(dir, '../..')])
    if (existsSync(join(candidate, 'native/full/manifest.json'))) return resolve(candidate);
  throw new Error(`cache sans native/full/manifest.json : ${dir}`);
}
