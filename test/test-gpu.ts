// The hardware-test runner: correctness probes from `test/justesse/` then render proofs from
// `test/browser/`, one by one. Paths are resolved from the repo root, never from the current
// directory: the command gives the same result wherever it is launched from.
//
// Both folders are discovered by a rule, never by a hand-held list: a file one forgets to add
// does not run, and nothing says so. What cannot run here is declared below with its reason —
// excluded out loud, never in silence.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const JUSTESSE = 'test/justesse';
const BROWSER = 'test/browser';

/** A setup the runner does not provide: the proof is sound, the machine is not ready. */
export const MONTAGE = 'setup';
/** An engine defect: the proof fails because it is right. Each one carries a TODO line. */
export const REGRESSION = 'regression';
/**
 * The proof holds a hand copy of a contract that the source evolved without it. The engine is
 * correct, the duplicate drifted: it is repaired by reading the contract instead of recopying it.
 */
export const DOUBLE_PERIME = 'stale duplicate';

/**
 * Render proofs that `pnpm run test:gpu` does not launch, and why. A `REGRESSION` entry is an
 * open debt, not a waiver: it is removed by fixing the engine.
 */
export const BROWSER_ECARTES = new Map<string, [string, string]>();

/**
 * Executable probes of `test/justesse/`: those whose name carries a hyphen. The other files in
 * the folder are their support modules, imported by them and never launched alone.
 */
export function listJustesseTests() {
  return readdirSync(join(RACINE, JUSTESSE))
    .filter((fichier) => fichier.includes('-') && fichier.endsWith('.ts'))
    .sort()
    .map((fichier) => `${JUSTESSE}/${fichier}`);
}

/** Every `*.browser.ts` present on disk, excluded ones included: the folder's reference. */
export function listBrowserFiles() {
  return readdirSync(join(RACINE, BROWSER))
    .filter((fichier) => fichier.endsWith('.browser.ts'))
    .sort();
}

/** Render proofs the runner launches: the folder, minus what is declared excluded. */
export function listBrowserTests() {
  return listBrowserFiles()
    .filter((fichier) => !BROWSER_ECARTES.has(fichier.slice(0, -'.browser.ts'.length)))
    .map((fichier) => `${BROWSER}/${fichier}`);
}

/** What the command did not prove, stated before launching anything. */
export function ecartsRapportes() {
  return [...BROWSER_ECARTES].map(([nom, [genre, motif]]) => `  ${genre} — ${nom} : ${motif}`);
}

/** `node` arguments: the flags, then the requested target or the full list. */
export function buildTestGpuArgs(cliArgs: string[] = []): string[] {
  const flags = ['--experimental-strip-types', '--test', '--test-concurrency=1'];
  if (cliArgs.length > 0) return [...flags, ...cliArgs];
  return [...flags, ...listJustesseTests(), ...listBrowserTests()];
}

export function runGpuTests(args = process.argv.slice(2)) {
  if (args.length === 0 && BROWSER_ECARTES.size > 0)
    console.log(
      `${BROWSER_ECARTES.size} render proofs excluded:\n${ecartsRapportes().join('\n')}\n`,
    );
  const resultat = spawnSync('node', buildTestGpuArgs(args), { stdio: 'inherit', cwd: RACINE });
  if (resultat.error) throw resultat.error;
  process.exit(resultat.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runGpuTests();
