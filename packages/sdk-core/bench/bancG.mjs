// Banc du lot G. Même règle que les lots A et F — résultat identique au bit près ou la ligne tombe —
// donc le même `compare` et le même tableau ; seul le dossier de fragments change, pour que le lot G
// ait son propre tableau. Le banc natif dépose ses lignes dans le même dossier, au même format.
import { join } from 'node:path';
import { RACINE, verifieEtDepose } from './banc.mjs';

export const FRAGMENTS_G = join(RACINE, '.mesure', 'calculs-g');

/** Vérifie l'égalité bit à bit du domaine, puis dépose ses lignes dans le dossier du lot G. */
export function verifieEtDeposeG(domaine, intitule, lignes) {
  verifieEtDepose(domaine, intitule, lignes, FRAGMENTS_G);
}
