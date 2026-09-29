// Measurement base paths, written once: repo root, fragment directory deposited by benchmarks,
// baseline directory, the output folder of a batch, and rule mapping domain to filename.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FRAGMENTS = join(RACINE, '.mesure', 'perf');
const BASELINES = join(RACINE, '.mesure', 'baselines');

/** Moves `measureOutput`'s root: the proof import test points its children at its own scratch. */
export const MEASURE_OUT = 'TRILLION3D_MEASURE_OUT';

/** Where a bench, cook or browser proof writes: `.mesure/out/<batch>/…`, off git (AGENTS.md). */
export const measureOutput = (...parts: string[]) =>
  join(process.env[MEASURE_OUT] ?? join(RACINE, '.mesure', 'out'), ...parts);

/** Sanitizes a domain name for use as a filename. */
const assainir = (domaine: string) => domaine.replace(/[/\\]/g, '-').replace(/^-+|-+$/g, '');

export const cheminFragment = (domaine: string) => join(FRAGMENTS, `${assainir(domaine)}.json`);
export const cheminBaseline = (domaine: string) => join(BASELINES, `${assainir(domaine)}.json`);
export const dossierBaselines = BASELINES;
