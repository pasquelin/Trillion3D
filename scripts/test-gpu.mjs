// L'exécuteur des tests matériels : les sondes de justesse de `test/justesse/` puis les tests de
// rendu de `test/browser/`, un par un. Les chemins sont résolus depuis la racine du dépôt, jamais
// depuis le répertoire courant : la commande donne le même résultat d'où qu'on la lance.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BROWSER_GPU_TESTS = [
  'test/browser/cisaillementTransform.browser.mjs',
  'test/browser/coneEchelleNonUniforme.browser.mjs',
  'test/browser/coupeGpuTenue.browser.mjs',
  'test/browser/depthConventionMoteurComplet.browser.mjs',
  'test/browser/gpuTextureWrap.browser.mjs',
  'test/browser/hizCameraRig.browser.mjs',
  'test/browser/imageTenueCouleur.browser.mjs',
  'test/browser/inverseTransposeePetiteEchelle.browser.mjs',
  'test/browser/normalTransformArithmetique.browser.mjs',
  'test/browser/normaleEclairagePetiteEchelle.browser.mjs',
  'test/browser/normaleEclairageSubstitutionsRefusees.browser.mjs',
  'test/browser/reflexionFaceEliminee.browser.mjs',
  'test/browser/setTransformParentPerime.browser.mjs',
  'test/browser/transparentTransform.browser.mjs',
];

/**
 * Les sondes exécutables de `test/justesse/` : celles dont le nom porte un tiret. Les autres
 * fichiers du dossier sont leurs modules d'appui, importés par elles et jamais lancés seuls.
 */
export function listJustesseTests(dossier = 'test/justesse') {
  return readdirSync(join(RACINE, dossier))
    .filter((fichier) => fichier.includes('-') && fichier.endsWith('.mjs'))
    .sort()
    .map((fichier) => `${dossier}/${fichier}`);
}

/** Les arguments de `node` : les drapeaux, puis la cible demandée ou la liste complète. */
export function buildTestGpuArgs(cliArgs = [], dossier = 'test/justesse') {
  const flags = ['--experimental-strip-types', '--test', '--test-concurrency=1'];
  if (cliArgs.length > 0) return [...flags, ...cliArgs];
  return [...flags, ...listJustesseTests(dossier), ...BROWSER_GPU_TESTS];
}

export function runGpuTests(args = process.argv.slice(2)) {
  const resultat = spawnSync('node', buildTestGpuArgs(args), { stdio: 'inherit', cwd: RACINE });
  if (resultat.error) throw resultat.error;
  process.exit(resultat.status ?? 1);
}

if (process.argv[1] && relative(fileURLToPath(import.meta.url), process.argv[1]) === '')
  runGpuTests();
