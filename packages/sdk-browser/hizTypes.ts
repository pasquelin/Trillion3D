import type * as THREE from 'three';
import type { HizFlat } from '../sdk-core/index.ts';

export type HizPage = {
  min: number[];
  max: number[];
  matrix: THREE.Matrix4;
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
/** La pyramide plate du chemin par image, avec la taille de l'image qu'elle décrit. */
export type HizPyramid = HizFlat & { width: number; height: number };
