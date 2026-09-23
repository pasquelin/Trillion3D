import type { HizFlat } from '../../../sdk-core/src/index.ts';
import type { MatrixElements } from '../math/matrixElements.ts';

export type HizPage = {
  min: number[];
  max: number[];
  matrix: MatrixElements;
  url?: string;
  clusterId?: string;
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
