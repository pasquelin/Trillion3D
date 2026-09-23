/**
 * The example kit, served beside the engine as `runtime/kit.js`: what an example page needs
 * around its render and nothing of the engine — a settings panel it declares in a few lines,
 * a corner of the frame's measured counters, and a game's menu and pause while the mouse is free.
 */
export { controls, type ControlSpec, type ControlValues } from './controls.ts';
export { readout } from './readout.ts';
export { stats } from './stats.ts';
export { isCapture, play, type Game, type PlayOptions } from './play.ts';
export type { GameKey, GameOption, MenuLabels } from './gameMenu.ts';
