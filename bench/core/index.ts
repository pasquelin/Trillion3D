// Single entry point for performance benchmarks. A benchmark imports this file alone: measurement,
// report, bitwise comparison, and ULP discrepancy count all come from ./.
export { RACINE } from './paths.ts';
export { compare, graine, ligneDecrite, mesure, stress } from './measure.ts';
export type { Mesure, MesureCas } from './measure.ts';
export { rapport } from './report.ts';
export { ecart } from './diff.ts';
export { compteur, note, parcours } from './ulp.ts';
