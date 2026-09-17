// L'entrée unique des bancs de performance. Un banc importe ce seul fichier : la mesure, le
// rapport, la comparaison bit à bit et le compte d'écarts en ULP viennent tous de `socle/`.
export { RACINE, compare, graine, ligneDecrite, mesure, stress } from './socle/mesure.mjs';
export { rapport } from './socle/rapport.mjs';
export { ecart } from './socle/ecart.mjs';
export { compteur, note, parcours, ulpEntre } from './socle/ulp.mjs';
