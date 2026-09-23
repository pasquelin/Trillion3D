// Single entry point for performance benchmarks. A benchmark imports this file alone: measurement,
// report, bitwise comparison, and ULP discrepancy count all come from ./.
export { RACINE } from './chemins.ts';
export { compare, graine, ligneDecrite, mesure, stress } from './mesure.ts';
export type { Mesure, MesureCas } from './mesure.ts';
export { rapport } from './rapport.ts';
export { ecart } from './ecart.ts';
export { compteur, note, parcours } from './ulp.ts';
