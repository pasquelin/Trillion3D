import type { HizFlat } from '../../../sdk-core/src/index.ts';
import type { VisMaterial } from '../visibility/types.ts';
import type { MovedBox } from '../page/selection/types.ts';

export type HizPage = {
  min: number[];
  max: number[];
  /** Where a dynamic page's vertices are this frame (`rowBox`). */
  moved?: MovedBox;
  url?: string;
  clusterId?: string;
  /** The surface it wears: one never culled (`neverCulled`) is never rejected. */
  material?: Pick<VisMaterial, 'sprite'>;
};
/** Flat pyramid of the per-frame path: level 0 already holds the frame size. */
export type HizPyramid = HizFlat;
