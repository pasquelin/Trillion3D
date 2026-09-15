// Le dist d'un côté de la comparaison : un dossier `dist/` déjà construit, ou une référence git
// extraite hors du dépôt puis construite. Séparé de `options.mjs` : résoudre un côté, c'est du
// travail de dépôt et de build, pas de la lecture d'arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const buildDist = (dir) => execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });

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
