/**
 * The example kit, served beside the engine as `runtime/kit.js`: what an example page needs
 * around its render and nothing of the engine — a settings panel it declares in a few lines,
 * and a corner of the frame's measured counters.
 */
export { controls, type ControlSpec, type ControlValues } from './controls.ts';
export { readout } from './readout.ts';
export { stats } from './stats.ts';
