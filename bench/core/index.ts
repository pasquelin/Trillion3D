// Single entry point for performance benchmarks. A benchmark imports this file alone: measurement,
// report and bitwise comparison all come from ./.
export { xorshiftRandom, measure, parElement } from './measure.ts'
export { compare, stress } from './measureStress.ts'
export type { Measurement } from '../../site/examples/kit/measureTypes.ts'
export type { MeasureCase } from './measure.ts'
export { rapport } from './report.ts'
