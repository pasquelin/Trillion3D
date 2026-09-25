import type { HizFlat } from '../../../sdk-core/src/index.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import type { VisMaterial } from '../visibility/types.ts';

export type HizPage = {
  min: number[];
  max: number[];
  matrix: MatrixElements;
  url?: string;
  clusterId?: string;
  /** The surface it wears: one never culled (`neverCulled`) is never rejected. */
  material?: Pick<VisMaterial, 'sprite'>;
};
export type HizBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  nearestDepth: number;
  clipsNear: boolean;
};
/** Flat pyramid of the per-frame path: level 0 already holds the frame size. */
export type HizPyramid = HizFlat;
