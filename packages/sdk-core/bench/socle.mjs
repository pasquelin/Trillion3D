// Single entry point for performance benchmarks. A benchmark imports this file alone: measurement,
// report, bitwise comparison, and ULP discrepancy count all come from socle/.
export { RACINE } from './socle/chemins.mjs';
export { compare, graine, ligneDecrite, mesure, stress } from './socle/mesure.mjs';
export { rapport } from './socle/rapport.mjs';
export { ecart } from './socle/ecart.mjs';
export { compteur, note, parcours } from './socle/ulp.mjs';
