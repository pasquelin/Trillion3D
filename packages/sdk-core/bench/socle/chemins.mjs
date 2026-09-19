// Measurement base paths, written once: repo root, fragment directory
// deposited by benchmarks, baseline directory, and rule mapping domain to filename.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const FRAGMENTS = join(RACINE, '.mesure', 'perf');
const BASELINES = join(RACINE, '.mesure', 'baselines');

/** Sanitizes a domain name for use as a filename. */
const assainir = (domaine) => domaine.replace(/[/\\]/g, '-').replace(/^-+|-+$/g, '');

export const cheminFragment = (domaine) => join(FRAGMENTS, `${assainir(domaine)}.json`);
export const cheminBaseline = (domaine) => join(BASELINES, `${assainir(domaine)}.json`);
export const dossierBaselines = BASELINES;
