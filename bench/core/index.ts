// Single entry point for performance benchmarks. A benchmark imports this file alone: measurement,
// report, bitwise comparison, and ULP discrepancy count all come from ./.
export { RACINE } from './paths.ts';
export { graine, mesure } from './measure.ts';
export { compare, stress } from './measureStress.ts';
export type { Measurement } from '../../site/examples/kit/measureTypes.ts';
export type { MesureCas } from './measure.ts';
export { rapport } from './report.ts';
export { ecart } from './diff.ts';
export { compteur, note, parcours } from './ulp.ts';
