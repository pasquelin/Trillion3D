/**
 * The example kit, served beside the engine as `runtime/kit.js`: what an example page needs
 * around its render and nothing of the engine — a settings panel it declares in a few lines,
 * a corner of the frame's measured counters, a game's menu and pause while the mouse is free,
 * the point the pointer shows on the ground, a video file the viewer picks, and a seeded
 * sequence that places the same scene on every run, noise to make sounds from, and a card that
 * names the error an example stops on. Its words, and the page's own, are read in
 * the reader's language before the example runs (`words.ts`).
 */
import { watchFailures } from './failure.ts';
import { loadWords } from './words.ts';

watchFailures();
await loadWords(document);

export { controls, type ControlSpec, type ControlValues } from './controls.ts';
export { playPickedVideo } from './media.ts';
export { circling, ease, flights, opening } from './opening.ts';
export { pointerOnPlane } from './pointer.ts';
export { hash, seeded } from './random.ts';
export { readout } from './readout.ts';
export { brownNoise, whiteNoise } from './sound.ts';
export { stats } from './stats.ts';
export { language, words } from './words.ts';
export { isCapture, play, type Game, type PlayOptions } from './play.ts';
export type { GameKey, GameOption } from './gameMenu.ts';
