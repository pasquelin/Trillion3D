// Les chemins du socle de mesure, écrits une fois : la racine du dépôt, le dossier des fragments
// déposés par les bancs, celui des baselines, et la règle qui fait d'un domaine un nom de fichier.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const FRAGMENTS = join(RACINE, '.mesure', 'perf');
const BASELINES = join(RACINE, '.mesure', 'baselines');

/** Assainit un nom de domaine pour l'employer comme nom de fichier. */
const assainir = (domaine) => domaine.replace(/[/\\]/g, '-').replace(/^-+|-+$/g, '');

export const cheminFragment = (domaine) => join(FRAGMENTS, `${assainir(domaine)}.json`);
export const cheminBaseline = (domaine) => join(BASELINES, `${assainir(domaine)}.json`);
export const dossierBaselines = BASELINES;
