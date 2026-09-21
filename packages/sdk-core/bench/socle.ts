// Single entry point for performance benchmarks. A benchmark imports this file alone: measurement,
// report, bitwise comparison, and ULP discrepancy count all come from socle/.
export { RACINE } from './socle/chemins.ts';
export { compare, graine, ligneDecrite, mesure, stress } from './socle/mesure.ts';
export type { Mesure, MesureCas } from './socle/mesure.ts';
export { rapport } from './socle/rapport.ts';
export { ecart } from './socle/ecart.ts';
export { compteur, note, parcours } from './socle/ulp.ts';
