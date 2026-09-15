// Banc du lot F. Même règle que le lot A — résultat identique au bit près ou la ligne tombe — donc
// le même `compare` et le même tableau ; seul le dossier de fragments change, pour que le lot F ait
// son propre tableau sans se mélanger à celui du lot A.
import { join } from 'node:path';
import { RACINE, verifieEtDepose } from './banc.mjs';

const FRAGMENTS_F = join(RACINE, '.mesure', 'calculs-f');

/** Vérifie l'égalité bit à bit du domaine, puis dépose ses lignes dans le dossier du lot F. */
export function verifieEtDeposeF(domaine, intitule, lignes) {
  verifieEtDepose(domaine, intitule, lignes, FRAGMENTS_F);
}
