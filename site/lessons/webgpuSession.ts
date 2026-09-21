import type { ScenarioState } from './scenarios.ts';
import type { Locale } from '../content/locale.ts';

export interface MountOptions {
  locale?: Locale;
  interactive?: boolean;
}

/** The handle a mounted 3D illustration hands back: feed it new state, drive its animation, tear it down. */
export interface IllustrationSession {
  update: (nextState: ScenarioState) => void;
  setAnimating?: (next: boolean) => void;
  dispose: () => void;
}

/** Camera distance per scenario, tuned so each demo's geometry fills the canvas. */
export const DISTANCE_BY_SCENARIO: Record<string, number> = {
  'compose-transform': 4,
  'matrix-chain': 4,
  perspective: 7,
  frustum: 10,
  'dot-product': 4,
  'cross-product': 4,
  normalize: 4,
  'box-grow': 8,
  'sphere-from-box': 7,
  hierarchy: 5,
  'color-space': 5,
  'lod-budget': 6,
};
