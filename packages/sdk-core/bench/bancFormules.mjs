// Banc du lot « formules communes ». Même règle que les autres lots — résultat identique au bit près
// ou la ligne tombe — donc le même `compare` et la même assertion ; seul le dossier de fragments
// change, pour que la factorisation ait son tableau sans se mélanger aux lots de performance.
import { join } from 'node:path';
import { RACINE, verifieEtDepose } from './banc.mjs';

const FRAGMENTS_FORMULES = join(RACINE, '.mesure', 'formules');

/** Vérifie l'égalité bit à bit du domaine, puis dépose ses lignes dans le dossier des formules. */
export function verifieEtDeposeFormules(domaine, intitule, lignes) {
  verifieEtDepose(domaine, intitule, lignes, FRAGMENTS_FORMULES);
}
