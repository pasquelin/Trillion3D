// Options, vues du banc et résolution des dists, pour `banc.mjs`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LAB, VIEWS } from './poses.mjs';

export { LAB, PATH_VERSION, VIEWS, checkLabPath, poseAt } from './poses.mjs';

// Le cache du banc, en lecture seule. `WG_ASSETS` laisse un agent pointer une copie figée hors du
// Lab : la mesure lit alors ses propres octets, et le Lab n'est ni lu ni touché pendant la série.
export const ASSETS = process.env.WG_ASSETS
  ? resolve(process.env.WG_ASSETS)
  : join(LAB, 'public/benchmark-assets');
export const SCENE = 'emerald-square';
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

export const ENGINES = {
  webgl: { backend: 'exactPagesBackend', id: 'exact-cluster-pages', flags: BASE_FLAGS },
  webgpu: { backend: 'webgpuPagesBackend', id: 'webgpu-page-raster', flags: WEBGPU_FLAGS },
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

/** Les arguments `--nom valeur` / `--nom=valeur` de la ligne de commande. */
function parseArgs(argv) {
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
  if (!ENGINES[engine])
    throw new Error(`--moteur doit valoir ${Object.keys(ENGINES).join(' ou ')}`);
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
  };
  if (settings.port === 5174)
    throw new Error("le port 5174 appartient au serveur de l'utilisateur");
  if (settings.frames < 1) throw new Error('--images doit être un entier positif');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(flags.get('out') ?? join(root, '.mesure/out', `${engine}-${stamp}`));
  return { flags, settings, views, out };
}
