// Options, vues du banc et résolution des dists, pour `banc.mjs`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { VIEWS } from './poses.mjs';
import { ASSETS } from './scene.mjs';
import { lightingSettings } from './optionsEclairage.mjs';

export { LAB, PATH_VERSION, VIEWS, checkLabPath, poseAt } from './poses.mjs';
export { labManifest, sceneOf } from './scene.mjs';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
export const ENGINES = {
  webgl: { backend: 'exactPagesBackend', id: 'exact-cluster-pages', flags: BASE_FLAGS },
  webgpu: { backend: 'webgpuPagesBackend', id: 'webgpu-page-raster', flags: WEBGPU_FLAGS },
  webgl2: {
    backend: 'autonomousPagesBackend',
    id: 'autonomous-pages-webgl',
    flags: BASE_FLAGS,
    autonome: true,
  },
};

const buildDist = (dir) => execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });

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
 * Ce que le serveur du harnais rend, et rien d'autre : les dépendances du navigateur, le cache du
 * Lab, le dist de chaque côté et son cache s'il en a un. `resources` est le dossier auquel le glTF
 * d'un cache compilé fait référence par chemin relatif (`assets/textures/...`) ; sans lui, un cache
 * compilé sans base de ressources sort ses textures en 404 et la mesure ne porte plus sur la scène.
 */
export function resolveMounts(root, sides, resources) {
  return [
    { prefix: '/vendor/three/', dir: packageDir(root, 'three') },
    { prefix: '/vendor/meshoptimizer/', dir: packageDir(root, 'meshoptimizer') },
    { prefix: '/benchmark-assets/', dir: ASSETS },
    ...(resources ? [{ prefix: '/assets/', dir: resources }] : []),
    ...sides.map((side) => ({ prefix: `/sdk/${side.name}/`, dir: side.dist })),
    ...sides
      .filter((side) => side.cache)
      .map((side) => ({ prefix: `/cache/${side.name}/`, dir: side.cache })),
  ].map((mount) => ({ ...mount, dir: resolve(mount.dir) }));
}

/** Les côtés demandés : « après » toujours, « avant » seulement s'il a été nommé. */
export function resolveSides({ apres, avant, root }) {
  const target = apres ?? join(root, 'dist');
  if (target === join(root, 'dist') && !existsSync(join(target, 'sdk-browser/index.js')))
    buildDist(root);
  const sides = [{ name: 'apres', ...resolveDist(target, 'apres', root) }];
  if (avant) sides.push({ name: 'avant', ...resolveDist(avant, 'avant', root) });
  return sides;
}

/** Résout un côté : un dossier `dist` existant, ou une référence git extraite puis construite.
 *  L'arbre extrait va hors du dépôt : un second `tsconfig.json` sous la racine casserait le lint. */
function resolveDist(value, label, root) {
  if (existsSync(join(value, 'sdk-browser/index.js')))
    return { dist: resolve(value), from: 'dossier' };
  if (existsSync(join(value, 'dist/sdk-browser/index.js')))
    return { dist: resolve(value, 'dist'), from: 'dossier' };
  const ref = execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${value}^{commit}`], {
    encoding: 'utf8',
  }).trim();
  const dir = join(tmpdir(), 'web-geometry-mesure', `${label}-${ref.slice(0, 12)}`);
  if (existsSync(join(dir, 'dist/sdk-browser/index.js')))
    return { dist: join(dir, 'dist'), from: `git ${ref.slice(0, 12)} (réutilisé)` };
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${root}' archive ${ref} | tar -x -C '${dir}'`]);
  execFileSync('ln', ['-sfn', join(root, 'node_modules'), join(dir, 'node_modules')]);
  buildDist(dir);
  return { dist: join(dir, 'dist'), from: `git ${ref.slice(0, 12)}` };
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
    profileFrames: number('images-profil', 120),
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
  };
  if (![1, 4, 9, 12].includes(settings.instances))
    throw new Error('--instances doit valoir 1, 4, 9 ou 12');
  if (settings.lights < 0) throw new Error('--lampes doit être un entier positif ou nul');
  if (settings.port === 5174)
    throw new Error("le port 5174 appartient au serveur de l'utilisateur");
  if (settings.frames < 1) throw new Error('--images doit être un entier positif');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(flags.get('out') ?? join(root, '.mesure/out', `${engine}-${stamp}`));
  // `--ressources` : la base que le glTF d'un cache compilé désigne par chemin relatif, montée
  // sous `/assets/`. Sans elle, un tel cache sort ses textures en 404 et la mesure change de scène.
  const resourcesDir = flags.get('ressources');
  return { flags, settings, views, out, resources: resourcesDir ? resolve(resourcesDir) : null };
}
