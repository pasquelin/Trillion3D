// Trajectoire du banc, résolution des dists et statistiques, pour `lot4.mjs`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const LAB = '/Users/pasquelin/Applications/render-tech-lab';
export const ASSETS = join(LAB, 'public/benchmark-assets');
export const SCENE = 'emerald-square';
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Copie littérale de `urbanPath` / `streetLevel` de `render-tech-lab/src/lab/modelCampaign.ts`
// (pathVersion 5). Le Lab n'est pas importable ici : son module est en TypeScript et tire tout le
// banc 15 avec lui. La copie est donc vérifiée contre la source à chaque exécution, et le harnais
// refuse de mesurer si elle a bougé.
const PATH_VERSION = 5;
const POINTS_SOURCE =
  ' const points=[[.72,28,.78],[.2,8,.26],[.05,1.2,.08],[-.08,1.7,.12],[-.03,1.5,.04],[-.03,1.5,.04],[.3,10,-.26],[-.38,8,-.36],[-.48,12,.46],[.72,28,.78]];';
const POINTS = [
  [0.72, 28, 0.78],
  [0.2, 8, 0.26],
  [0.05, 1.2, 0.08],
  [-0.08, 1.7, 0.12],
  [-0.03, 1.5, 0.04],
  [-0.03, 1.5, 0.04],
  [0.3, 10, -0.26],
  [-0.38, 8, -0.36],
  [-0.48, 12, 0.46],
  [0.72, 28, 0.78],
];
const FRAMES_PER_SEGMENT = 60;
export { PATH_VERSION };

/** Les trois vues du banc que ce lot mesure, par indice dans la trajectoire. */
export const VIEWS = {
  generale: { index: 0, segment: 'Vue générale du modèle' },
  sol: { index: 2 * FRAMES_PER_SEGMENT, segment: 'Déplacement au niveau de référence' },
  detail: { index: 4 * FRAMES_PER_SEGMENT, segment: 'Gros plan sur une géométrie détaillée' },
};

/** Refuse de mesurer si la trajectoire du banc a changé sous la copie ci-dessus. */
export function checkLabPath() {
  const source = readFileSync(join(LAB, 'src/lab/modelCampaign.ts'), 'utf8');
  const version = source.match(/export const pathVersion\s*=\s*(\d+)/);
  const points = source.split('\n').find((line) => line.includes('const points=[['));
  if (!version || Number(version[1]) !== PATH_VERSION)
    throw new Error(
      `trajectoire du banc en version ${version ? version[1] : '?'} et non ${PATH_VERSION} : recopier urbanPath`,
    );
  if (points !== POINTS_SOURCE)
    throw new Error('les points de la trajectoire du banc ont changé : recopier urbanPath');
  const names = source.match(/export const segmentNames=\[([^\]]*)\]/);
  for (const view of Object.values(VIEWS))
    if (names && !names[1].includes(view.segment))
      throw new Error(`le segment « ${view.segment} » n'existe plus dans le banc`);
}

/** `streetLevel` du banc : plan d'origine si la géométrie l'enjambe, sinon le plancher de l'AABB. */
const streetLevel = (bounds) => (bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y);

/** La pose du banc à l'indice `index`, calculée comme `urbanPath` la calcule. */
export function poseAt(bounds, index) {
  const min = bounds.min,
    max = bounds.max;
  const cx = (min.x + max.x) / 2,
    cz = (min.z + max.z) / 2;
  const sx = max.x - min.x,
    sy = max.y - min.y,
    sz = max.z - min.z;
  const radius = Math.hypot(sx, sy, sz) / 2;
  const ground = streetLevel(bounds),
    block = Math.max(sx, sz);
  const eye = Math.max(block * 0.008, sy > 0 ? Math.min(2, sy * 0.03) : 1.6);
  const segment = Math.floor(index / FRAMES_PER_SEGMENT),
    frame = index % FRAMES_PER_SEGMENT;
  const t = frame / (FRAMES_PER_SEGMENT - 1);
  const a = POINTS[segment],
    b = POINTS[segment + 1] ?? POINTS[0];
  const p = a.map((v, i) => v + (b[i] - v) * t);
  return {
    position: [cx + p[0] * sx, Math.max(ground + eye, ground + p[1] * eye), cz + p[2] * sz],
    target: [cx, ground + eye * 2, cz],
    fov: 55,
    near: Math.max(radius / 10000, 0.01),
    far: radius * 20,
  };
}

const buildDist = (dir) => execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });

/** Les deux côtés demandés : « après » toujours, « avant » seulement s'il a été nommé. */
export function resolveSides({ apres, avant, root, out }) {
  const target = apres ?? join(root, 'dist');
  if (target === join(root, 'dist') && !existsSync(join(target, 'sdk-browser/index.js')))
    buildDist(root);
  const sides = [{ name: 'apres', ...resolveDist(target, 'apres', root, out) }];
  if (avant) sides.push({ name: 'avant', ...resolveDist(avant, 'avant', root, out) });
  return sides;
}

/** Résout un côté : un dossier `dist` existant, ou une référence git extraite puis construite. */
function resolveDist(value, label, root, out) {
  if (existsSync(join(value, 'sdk-browser/index.js')))
    return { dist: resolve(value), from: 'dossier' };
  if (existsSync(join(value, 'dist/sdk-browser/index.js')))
    return { dist: resolve(value, 'dist'), from: 'dossier' };
  const ref = execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${value}^{commit}`], {
    encoding: 'utf8',
  }).trim();
  const dir = join(out, `arbre-${label}-${ref.slice(0, 12)}`);
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

/** Les options du harnais, validées : ses drapeaux, ses réglages de mesure, son dossier de sortie. */
export function readOptions(argv, root) {
  const flags = parseArgs(argv);
  const number = (name, fallback) => {
    const value = Number(flags.get(name) ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`--${name} doit être un nombre`);
    return value;
  };
  const settings = {
    frames: number('images', 300),
    warmup: number('chauffe', 8),
    pixelError: number('pixel-error', 0),
    maxPages: number('max-pages', 100000),
    width: number('largeur', 1280),
    height: number('hauteur', 720),
    port: number('port', 0),
  };
  if (settings.port === 5174)
    throw new Error("le port 5174 appartient au serveur de l'utilisateur");
  if (settings.frames < 1) throw new Error('--images doit être un entier positif');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(flags.get('out') ?? join(root, '.mesure/out', stamp));
  return { flags, settings, OUT: out };
}

const quantile = (s, p) => s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)];
/** p50/p95/p99 d'une série, ou null si elle est vide. */
export function distribution(values) {
  const s = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    min: s[0],
    max: s.at(-1),
  };
}
