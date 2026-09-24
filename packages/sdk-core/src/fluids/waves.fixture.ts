import type { WaveSpec } from './waves.ts';

/** An eight-wave ocean (the `high` tier): swell to chop, 2.6 m of crest, steepest allowed. */
export const OCEAN: WaveSpec[] = [
  { direction: [1, 0.2], wavelength: 60, amplitude: 1.0, steepness: 0.9 },
  { direction: [0.8, 0.6], wavelength: 31, amplitude: 0.55, steepness: 0.9 },
  { direction: [0.3, 1], wavelength: 18, amplitude: 0.35, steepness: 0.9 },
  { direction: [-0.5, 1], wavelength: 11, amplitude: 0.25, steepness: 0.9, phase: 1 },
  { direction: [1, -0.7], wavelength: 7.3, amplitude: 0.18, steepness: 0.9, phase: 2 },
  { direction: [-1, 0.4], wavelength: 5.1, amplitude: 0.12, steepness: 0.9, phase: 3 },
  { direction: [0.1, -1], wavelength: 3.7, amplitude: 0.08, steepness: 0.9, phase: 4 },
  { direction: [0.6, 0.9], wavelength: 2.6, amplitude: 0.05, steepness: 0.9, phase: 5 },
];
