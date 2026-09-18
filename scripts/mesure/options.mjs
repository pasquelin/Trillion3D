// Options, vues du banc et montages du serveur, pour `banc.mjs`.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { VIEWS } from './poses.mjs';
import { ASSETS } from './scene.mjs';
import { lightingSettings } from './optionsEclairage.mjs';

export { PATH_VERSION, VIEWS, poseAt } from './poses.mjs';
export { assetsManifest, sceneOf } from './scene.mjs';
export { resolveSides } from './dists.mjs';
export { ENGINES, engineOf, equipSide, resolveCache, sideReport } from './optionsCote.mjs';
import { ENGINES } from './optionsCote.mjs';

/** Le dossier d'un paquet installé, cherché comme Node le cherche : de la racine vers le haut. Un
 *  worktree sans `node_modules` à lui trouve ainsi ceux de l'arbre de travail principal. */
function packageDir(root, name) {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`paquet introuvable : ${name}`);
  }
}

/**
 * Ce que le serveur du harnais rend, et rien d'autre : les dépendances du navigateur, les assets
 * du banc, le dist de chaque côté et son cache s'il en a un. `resources` est le dossier auquel le glTF
 * d'un cache compilé fait référence par chemin relatif (`assets/textures/...`) ; sans lui, un cache
 * compilé sans base de ressources sort ses textures en 404 et la mesure ne porte plus sur la scène.
 */
export function resolveMounts(root, sides, resources) {
  return [
    { prefix: '/vendor/three/', dir: packageDir(root, 'three') },
    // Les modules que la page importe par URL : `pageCoupe.mjs`, `pageTemoin.mjs`.
    { prefix: '/mesure/', dir: join(root, 'scripts/mesure') },
    { prefix: '/vendor/meshoptimizer/', dir: packageDir(root, 'meshoptimizer') },
    { prefix: '/benchmark-assets/', dir: ASSETS },
    ...(resources ? [{ prefix: '/assets/', dir: resources }] : []),
    ...sides.map((side) => ({ prefix: `/sdk/${side.name}/`, dir: side.dist })),
    ...sides
      .filter((side) => side.cache)
      .map((side) => ({ prefix: `/cache/${side.name}/`, dir: side.cache })),
  ].map((mount) => ({ ...mount, dir: resolve(mount.dir) }));
}

/** Les arguments `--nom valeur` / `--nom=valeur` de la ligne de commande. Partagé par les harnais :
 *  un seul endroit sait ce qu'un drapeau veut dire, et une valeur absente vaut `'true'`. */
export function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`argument inattendu : ${arg}`);
    const eq = arg.indexOf('=');
    if (eq > 0) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags.set(arg.slice(2), argv[++i]);
    else flags.set(arg.slice(2), 'true');
  }
  return flags;
}

/** Le chemin des calculs en lot imposé à la campagne, ou `auto` : le gouverneur arbitre alors. */
function mathPathOf(flags) {
  const value = flags.get('chemin-math') ?? 'auto';
  if (value !== 'auto' && value !== 'js' && value !== 'wasm')
    throw new Error('--chemin-math doit valoir auto, js ou wasm');
  return value;
}

/** Les options du harnais, validées : moteur, vues, seuils d'erreur, réglages, dossier de sortie. */
export function readOptions(argv, root) {
  const flags = parseArgs(argv);
  const number = (name, fallback) => {
    const value = Number(flags.get(name) ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`--${name} doit être un nombre`);
    return value;
  };
  const engine = flags.get('moteur') ?? 'webgl';
  if (!ENGINES[engine]) throw new Error(`--moteur doit valoir ${Object.keys(ENGINES).join(', ')}`);
  const views = (flags.get('vues') ?? 'generale,sol,rue').split(',').filter(Boolean);
  for (const view of views) if (!VIEWS[view]) throw new Error(`vue inconnue : ${view}`);
  const pixelErrors = String(flags.get('pixelError') ?? '0')
    .split(',')
    .filter(Boolean)
    .map((value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0)
        throw new Error(`--pixelError invalide : ${value}`);
      return parsed;
    });
  const settings = {
    engine,
    frames: number('images', 60),
    warmup: number('chauffe', 8),
    pixelErrors,
    maxPages: number('max-pages', 100000),
    width: number('largeur', 1280),
    height: number('hauteur', 720),
    port: number('port', 0),
    // `--profil off` rejoue la même série sans le chronométrage par étape : c'est la porte de
    // fidélité, deux exécutions dont seule cette option diffère.
    stageProfile: (flags.get('profil') ?? 'on') !== 'off',
    // Une campagne de ventilation met le détail « trace » des DEUX côtés, y compris celui qui ne
    // porte aucune variante : sans cela les deux côtés ne paieraient pas le même diagnostic.
    trace: [...flags.keys()].some((name) => name === 'variante' || name.startsWith('variante-')),
    profileFrames: number('images-profil', 120),
    // `--textures cache` : le moteur lit les niveaux de texture cuits dans le cache et le chargeur
    // n'ouvre plus les images sources. Réservé au moteur WebGPU, qui lit l'atlas ; le témoin Three
    // dessine la scène de l'hôte et garde ses images. Un dist d'avant cette option l'ignore.
    textureSource: flags.get('textures') === 'cache' ? 'cache' : 'host',
    // `--antialiasing off` : le moteur WebGPU rend sans gigue ni historique — le « avant » du lot
    // Lumière 16. Sans l'option, le moteur garde son défaut, l'accumulation temporelle active ; un
    // dist d'avant l'option l'ignore, ce qui permet de la laisser sur une comparaison avant/après.
    temporalAntialiasing: flags.get('antialiasing') !== 'off',
    // Le mode sans fenêtre plafonne l'affichage à 60 Hz sur cette machine : `--visible` ouvre une
    // vraie fenêtre quand la cadence compte.
    visible: flags.get('visible') === 'true',
    ...lightingSettings(flags, number),
    // `--camera-mobile` avance la pose d'un cran de la trajectoire du banc à chaque image mesurée,
    // au lieu de rejouer la même : c'est ce qui distingue une scène immobile d'une caméra qui bouge.
    movingCamera: flags.get('camera-mobile') === 'true',
    // `--instances` : le nombre de copies de l'objet posées en grille par le SDK. La mesure d'un
    // lot d'instances n'a de sens qu'à ce nombre-là ; il est consigné dans le rapport.
    instances: number('instances', 1),
    // `--isolation on` pose COOP/COEP sur le serveur du harnais : la page devient isolée entre
    // origines et le SDK prend son chemin de mémoire partagée. `off` par défaut.
    isolation: (flags.get('isolation') ?? 'off') === 'on',
    // `--chemin-math js|wasm` impose le chemin des calculs en lot pour toute la campagne : c'est
    // ainsi que les deux chemins se mesurent l'un contre l'autre, à scène et poses identiques.
    // `auto`, le défaut, laisse le gouverneur arbitrer par la mesure ; le relevé dit alors ce qu'il
    // a choisi, opération par opération. Aucun seuil n'est imposé ici.
    mathPath: mathPathOf(flags),
  };
  const isolation = flags.get('isolation') ?? 'off';
  if (isolation !== 'on' && isolation !== 'off')
    throw new Error('--isolation doit valoir on ou off');
  if (![1, 4, 9, 12].includes(settings.instances))
    throw new Error('--instances doit valoir 1, 4, 9 ou 12');
  if (settings.lights < 0) throw new Error('--lampes doit être un entier positif ou nul');
  if (settings.frames < 1) throw new Error('--images doit être un entier positif');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(flags.get('out') ?? join(root, '.mesure/out', `${engine}-${stamp}`));
  // `--ressources` : la base que le glTF d'un cache compilé désigne par chemin relatif, montée
  // sous `/assets/`. Sans elle, un tel cache sort ses textures en 404 et la mesure change de scène.
  const resourcesDir = flags.get('ressources');
  return { flags, settings, views, out, resources: resourcesDir ? resolve(resourcesDir) : null };
}
