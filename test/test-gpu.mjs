// L'exécuteur des tests matériels : les sondes de justesse de `test/justesse/` puis les preuves de
// rendu de `test/browser/`, un par un. Les chemins sont résolus depuis la racine du dépôt, jamais
// depuis le répertoire courant : la commande donne le même résultat d'où qu'on la lance.
//
// Les deux dossiers sont découverts par une règle, jamais par une liste tenue à la main : un
// fichier qu'on oublie d'ajouter ne s'exécute pas, et rien ne le dit. Ce qui ne peut pas tourner
// ici est déclaré ci-dessous avec son motif — écarté à voix haute, jamais en silence.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const JUSTESSE = 'test/justesse';
const BROWSER = 'test/browser';

/** Un montage que l'exécuteur ne fournit pas : la preuve est bonne, la machine n'est pas prête. */
export const MONTAGE = 'montage';
/** Un défaut du moteur : la preuve échoue parce qu'elle a raison. Chacun porte une ligne de TODO. */
export const REGRESSION = 'régression';
/**
 * La preuve tient une copie à la main d'un contrat que la source a fait évoluer sans elle. Le moteur
 * est juste, le double a dérivé : il se répare en lisant le contrat au lieu de le recopier.
 */
export const DOUBLE_PERIME = 'double périmé';

/**
 * Les preuves de rendu que `pnpm run test:gpu` ne lance pas, et pourquoi. Une entrée `REGRESSION`
 * est une dette ouverte, pas une dispense : elle se retire en corrigeant le moteur.
 */
/** Les preuves montées sur les pages du Lab : elles prennent son adresse par `LAB_URL`. */
const SUR_LE_LAB = 'montée sur les pages du Lab (`LAB_URL`)';
export const BROWSER_ECARTES = new Map([
  ['beaute-webgpu', [MONTAGE, `${SUR_LE_LAB} ; ses assets à recompiler`]],
  ['emeraude-webgpu', [MONTAGE, `${SUR_LE_LAB} ; à remonter sur le serveur du harnais`]],
  ['presentation-gpu', [MONTAGE, `${SUR_LE_LAB} ; ses assets à recompiler`]],
]);

/**
 * Les sondes exécutables de `test/justesse/` : celles dont le nom porte un tiret. Les autres
 * fichiers du dossier sont leurs modules d'appui, importés par elles et jamais lancés seuls.
 */
export function listJustesseTests() {
  return readdirSync(join(RACINE, JUSTESSE))
    .filter((fichier) => fichier.includes('-') && fichier.endsWith('.mjs'))
    .sort()
    .map((fichier) => `${JUSTESSE}/${fichier}`);
}

/** Tout `*.browser.mjs` présent sur le disque, écartés compris : la référence du dossier. */
export function listBrowserFiles() {
  return readdirSync(join(RACINE, BROWSER))
    .filter((fichier) => fichier.endsWith('.browser.mjs'))
    .sort();
}

/** Les preuves de rendu que l'exécuteur lance : le dossier, moins ce qui est déclaré écarté. */
export function listBrowserTests() {
  return listBrowserFiles()
    .filter((fichier) => !BROWSER_ECARTES.has(fichier.slice(0, -'.browser.mjs'.length)))
    .map((fichier) => `${BROWSER}/${fichier}`);
}

/** Ce que la commande n'a pas prouvé, dit avant de lancer quoi que ce soit. */
export function ecartsRapportes() {
  return [...BROWSER_ECARTES].map(([nom, [genre, motif]]) => `  ${genre} — ${nom} : ${motif}`);
}

/** Les arguments de `node` : les drapeaux, puis la cible demandée ou la liste complète. */
export function buildTestGpuArgs(cliArgs = []) {
  const flags = ['--experimental-strip-types', '--test', '--test-concurrency=1'];
  if (cliArgs.length > 0) return [...flags, ...cliArgs];
  return [...flags, ...listJustesseTests(), ...listBrowserTests()];
}

export function runGpuTests(args = process.argv.slice(2)) {
  if (args.length === 0 && BROWSER_ECARTES.size > 0)
    console.log(
      `${BROWSER_ECARTES.size} preuves de rendu écartées :\n${ecartsRapportes().join('\n')}\n`,
    );
  const resultat = spawnSync('node', buildTestGpuArgs(args), { stdio: 'inherit', cwd: RACINE });
  if (resultat.error) throw resultat.error;
  process.exit(resultat.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runGpuTests();
